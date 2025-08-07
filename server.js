const fetch = require("node-fetch");
const express = require("express");
const admin = require("firebase-admin");
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(bodyParser.json());

const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

app.post("/createCustomToken", async (req, res) => {
  const { lineUserId } = req.body;

  if (!lineUserId) {
    return res.status(400).send("Missing LINE user ID");
  }

  try {
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
      // LINEのIDトークンをLINEのAPIに送信してユーザー情報を取得
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
  
      // Firebaseのカスタムトークンを作成
      const customToken = await admin.auth().createCustomToken(lineUserId);
      res.send({ customToken });
    } catch (err) {
      console.error("LINE verify error:", err);
      res.status(500).send("Verification failed");
    }
  });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));