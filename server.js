const express = require("express");
const admin = require("firebase-admin");
const fetch = require("node-fetch");
const cors = require("cors");
const app = express();

// CORS設定オプション
const corsOptions = {
  origin: 'https://be-zero-413cf.web.app',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions), (req, res) => {
  res.sendStatus(200);
});
app.use(express.json());

// Firebase Admin SDK初期化
const serviceAccount = require("./serviceAccountKey.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// LINEアクセストークン（環境変数）
const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;
console.log("LINE_ACCESS_TOKEN:", LINE_ACCESS_TOKEN ? "設定済み" : "未設定");
if (!LINE_ACCESS_TOKEN) {
  console.error("Error: 環境変数 LINE_ACCESS_TOKEN が設定されていません");
  process.exit(1);
}

// キャッシュ用
let cachedReservations = null;
let cacheTimestamp = 0;
const CACHE_TTL = 1000 * 60; // 1分

// GET /reservations?start=YYYY-MM-DD-HH&end=YYYY-MM-DD-HH
app.get('/reservations', async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) {
    return res.status(400).send("start と end パラメータは必須です");
  }
  try {
    const now = Date.now();
    if (cachedReservations && (now - cacheTimestamp < CACHE_TTL)) {
      return res.json(cachedReservations);
    }
    const snapshot = await admin.firestore().collection('reservations')
      .where('datetime', '>=', start)
      .where('datetime', '<=', end)
      .get();
    const reservations = snapshot.docs.map(doc => doc.data());
    cachedReservations = reservations;
    cacheTimestamp = now;
    res.json(reservations);
  } catch (error) {
    console.error("Error fetching reservations:", error);
    res.status(500).send("Server error");
  }
});

// POST /reservations 予約登録処理
// 期待されるJSON例: { uid: "ユーザUID", datetime: "YYYY-MM-DD-HH" }
app.post('/reservations', async (req, res) => {
  const { uid, datetime } = req.body;
  if (!uid || !datetime) {
    return res.status(400).send({ success: false, message: "uid と datetime は必須です" });
  }
  try {
    // 既に同じ日時に予約があるか確認
    const querySnap = await admin.firestore().collection('reservations')
      .where('datetime', '==', datetime)
      .get();
    if (!querySnap.empty) {
      return res.status(409).send({ success: false, message: "この日時は既に予約済みです" });
    }

    // 予約追加
    await admin.firestore().collection('reservations').add({
      userId: uid,
      datetime,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // キャッシュクリア（次回GETで再取得させる）
    cachedReservations = null;

    res.send({ success: true });
  } catch (error) {
    console.error("予約登録エラー:", error);
    res.status(500).send({ success: false, message: "予約登録に失敗しました" });
  }
});

// 既存のカスタムトークン発行やLINE通知APIも同じまま残す
app.post("/createCustomToken", async (req, res) => {
  const { lineUserId } = req.body;
  if (!lineUserId) {
    return res.status(400).send("Missing LINE user ID");
  }
  try {
    let userRecord;
    try {
      userRecord = await admin.auth().getUser(lineUserId);
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        userRecord = await admin.auth().createUser({ uid: lineUserId });
      } else {
        throw error;
      }
    }
    const customToken = await admin.auth().createCustomToken(lineUserId);
    res.send({ customToken });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).send("Server error");
  }
});

app.post("/verify", async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) {
    return res.status(400).send("Missing ID token from LINE");
  }
  try {
    const response = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `id_token=${encodeURIComponent(idToken)}&client_id=2007886469`
    });
    const data = await response.json();
    if (!data.sub) {
      return res.status(401).send("Invalid LINE ID token");
    }
    const lineUserId = data.sub;
    let userRecord;
    try {
      userRecord = await admin.auth().getUser(lineUserId);
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        userRecord = await admin.auth().createUser({ uid: lineUserId });
      } else {
        throw error;
      }
    }
    const customToken = await admin.auth().createCustomToken(lineUserId);
    res.send({ customToken });
  } catch (err) {
    console.error("LINE verify error:", err);
    res.status(500).send("Verification failed");
  }
});

app.post("/sendLineNotification", async (req, res) => {
  const { lineUserId, message } = req.body;
  if (!lineUserId || !message) {
    return res.status(400).send("Missing parameters");
  }
  try {
    const response = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LINE_ACCESS_TOKEN}`
      },
      body: JSON.stringify({
        to: lineUserId,
        messages: [{ type: "text", text: message }]
      })
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error("LINE通知エラー:", errorText);
      return res.status(500).send("Failed to send LINE notification");
    }
    res.send({ success: true });
  } catch (error) {
    console.error("LINE通知送信例外:", error);
    res.status(500).send("Server error");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
