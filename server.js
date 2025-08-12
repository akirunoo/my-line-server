const express = require("express");
const admin = require("firebase-admin");
const fetch = require("node-fetch");
const cors = require("cors");
const app = express();
// CORS設定オプション
const corsOptions = {
  origin: 'https://be-zero-413cf.web.app',  // 許可するフロントのURL
  methods: ['GET', 'POST', 'OPTIONS'],       // 許可するHTTPメソッド
  allowedHeaders: ['Content-Type', 'Authorization'],  // 許可するヘッダー
  credentials: true,                          // クッキーや認証情報を許可
};
// CORSミドルウェアを全ルートに適用
app.use(cors(corsOptions));
// プリフライトリクエストに対するレスポンス
app.options('*', cors(corsOptions), (req, res) => {
  res.sendStatus(200);
});
// JSONボディパーサー
app.use(express.json());
// Firebase Admin SDK初期化
const serviceAccount = require("./serviceAccountKey.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
// 環境変数LINE_ACCESS_TOKENチェック
const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;
console.log("LINE_ACCESS_TOKEN:", LINE_ACCESS_TOKEN ? "設定済み" : "未設定");
if (!LINE_ACCESS_TOKEN) {
  console.error("Error: 環境変数 LINE_ACCESS_TOKEN が設定されていません");
  process.exit(1);
}
// ルート定義
app.get('/ping', (req, res) => {
  res.status(200).send('OK');
});
let cachedReservations = null;
let cacheTimestamp = 0;
const CACHE_TTL = 1000 * 60; // 1分キャッシュ
app.get('/reservations', async (req, res) => {
  // クエリパラメータで期間指定を受け取る
  const start = req.query.start; // 例: "2025-08-04-00"
  const end = req.query.end;     // 例: "2025-08-10-23"
  if (!start || !end) {
    return res.status(400).send("start と end パラメータは必須です");
  }
  try {
    const now = Date.now();
    if (cachedReservations && (now - cacheTimestamp < CACHE_TTL)) {
      // キャッシュ有効なら返す（必要に応じてキャッシュも期間絞り込み対応に）
      return res.json(cachedReservations);
    }
    // Firestoreでdatetimeフィールドの範囲クエリ
    const snapshot = await admin.firestore().collection('reservations')
      .where('datetime', '>=', start)
      .where('datetime', '<=', end)
      .get();
    const reservations = snapshot.docs.map(doc => doc.data());
    cachedReservations = reservations;
    cacheTimestamp = now;
    res.json(reservations);
  } catch (error) {
    console.error('Error fetching reservations:', error);
    res.status(500).send('Server error');
  }
});
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
  console.log("sendLineNotification called with body:", req.body);
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
        messages: [
          {
            type: "text",
            text: message
          }
        ]
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
// ポート設定
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
