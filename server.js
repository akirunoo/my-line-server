const express = require("express");
const admin = require("firebase-admin");
const fetch = require("node-fetch");
const cors = require("cors");
const app = express();

// 1. CORS設定（必ず一番上で使う）
const corsOptions = {
  origin: 'https://be-zero-413cf.web.app', // フロントのURLに合わせてください
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};
app.use(cors(corsOptions));

// 2. プリフライトリクエストに対して明示的に200を返す
app.options('*', cors(corsOptions), (req, res) => {
  res.sendStatus(200);
});

// 3. 全リクエストにCORSヘッダーを付与（念のため）
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://be-zero-413cf.web.app');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  next();
});

// 4. JSONボディパーサー
app.use(express.json());

// 5. Firebase Admin SDK初期化
const serviceAccount = require("./serviceAccountKey.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// 6. 環境変数LINE_ACCESS_TOKENチェック
const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;
console.log("LINE_ACCESS_TOKEN:", LINE_ACCESS_TOKEN ? "設定済み" : "未設定");
if (!LINE_ACCESS_TOKEN) {
  console.error("Error: 環境変数 LINE_ACCESS_TOKEN が設定されていません");
  process.exit(1);
}

// 7. ルート群

// 軽量レスポンスのping用API（Express）
app.get('/ping', (req, res) => {
  res.status(200).send('OK');
});

// カスタムトークン発行API
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

// LINE IDトークン検証API
app.post("/verify", async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) {
    return res.status(400).send("Missing ID token from LINE");
  }
  try {
    const response = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `id_token=${idToken}&client_id=2007886469`
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

// LINE通知送信API
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