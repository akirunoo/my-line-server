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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));