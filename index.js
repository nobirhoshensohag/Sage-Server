const express = require("express");
const app = express();
const port = process.env.PORT || 5000;
const cors = require("cors");
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Sage Server is running");
});
app.listen(() => {
  console.log(`Sage is hitting on port ${port}`);
});