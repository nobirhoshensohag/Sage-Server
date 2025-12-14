const express = require("express");
const app = express();
require("dotenv").config()
const port = process.env.PORT || 5000;
const cors = require("cors");
app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_NAME}:${process.env.DB_PASS}@cluster1.h19g7bt.mongodb.net/?appName=Cluster1`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const db = client.db("sage");
    const usersCollection = db.collection("users");
    const lessonsCollection = db.collection("lessons");
    const favoritesCollection = db.collection("favorites");
    const likesCollection = db.collection("likes");

     app.post("/users", async (req, res) => {
      const user = req.body;
      user.createdAt = new Date();
      const email = user.email;
      const userExists = await usersCollection.findOne({ email });
      if (userExists) {
        return res.send({ message: "user exists" });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });
    app.get("/users", async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.email = email;
      }
      const result = await usersCollection.find(query).toArray();
      res.send(result);
    });

     //lessons related apis
    app.post("/lessons", async (req, res) => {
      const lesson = req.body;
      lesson.comments = [];
      lesson.likes = 0;
      lesson.favorites = 0;
      lesson.postedAt = new Date();
      lesson.isFeatured = false;

      const result = await lessonsCollection.insertOne(lesson);
      res.send(result);
    });
    app.get("/lessons", async (req, res) => {
      const isPrivate = req.query.isPrivate;
      const { email, limit = 0, skip = 0, sort = "latest", order } = req.query;
      const query = {};
      const sortOption = {};
      sortOption[sort] = order === "asc" ? 1 : -1;
      if (isPrivate) {
        query.isPrivate = isPrivate;
      }
      if (email) {
        query.email = email;
      }
      const result = await lessonsCollection
        .find(query)
        .sort()
        .limit(Number(limit))
        .skip(Number(skip))
        .toArray();

      const count = await lessonsCollection.countDocuments(query);
      res.send({ result, total: count });
    });
    app.get("/lessons/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await lessonsCollection.findOne(query);
      res.send(result);
    });
    app.patch("/lessons/:id", async (req, res) => {
      const updatedLesson = req.body;
      updatedLesson.commentedAt = new Date();
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const update = {
        $push: {
          comments: {
            $each: [updatedLesson],
            $position: 0,
          },
        },
      };
      const result = await lessonsCollection.updateOne(query, update);
      res.send(result);
    });


    //favorite related apis
    app.post("/favorites", async (req, res) => {
      const favorite = req.body;
      favorite.favoriteAt = new Date();
      const result = await favoritesCollection.insertOne(favorite);

      const filter = { _id: new ObjectId(favorite.postId) };
      const update = {
        $inc: { favorites: 1 },
      };
      const favoritesCount = await lessonsCollection.updateOne(filter, update);
      res.send({ result, favoritesCount });
    });
    app.get("/favorites", async (req, res) => {
      const email = req.query.email;
      const postId = req.query.postId;
      const query = {};
      if (email) {
        query.email = email;
      }
      if (postId) {
        query.postId = postId;
      }
      const result = await favoritesCollection.find(query).toArray();
      res.send(result);
    });
    app.get("/favorites/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await favoritesCollection.findOne(query);
      res.send(result);
    });
    app.delete("/favorites/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const favoriteDoc = await favoritesCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!favoriteDoc) {
        return res.status(404).send({ error: "Favorite not found" });
      }

      const result = await favoritesCollection.deleteOne(query);
      const filter = { _id: new ObjectId(favoriteDoc.postId) };
      const update = {
        $inc: { favorites: -1 },
      };
      const favoritesCount = await lessonsCollection.updateOne(filter, update);
      console.log("result and likesCount", result);
      res.send({ result, favoritesCount });
    });

    //likes related apis
    app.post("/likes", async (req, res) => {
      const like = req.body;
      like.likedAt = new Date();

      const result = await likesCollection.insertOne(like);
      const filter = { _id: new ObjectId(like.postId) };
      const update = {
        $inc: { likes: 1 },
      };
      const likesCount = await lessonsCollection.updateOne(filter, update);
      console.log("result and likesCount", result, likesCount);
      res.send({ result, likesCount });
    });
    app.get("/likes", async (req, res) => {
      const email = req.query.email;
      const postId = req.query.postId;

      const query = {};
      if (email) {
        query.email = email;
      }
      if (postId) {
        query.postId = postId;
      }
      const result = await likesCollection.find(query).toArray();
      console.log(result);
      res.send(result);
    });
    app.get("/likes/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await likesCollection.findOne(query);
      res.send(result);
    });
    app.delete("/likes/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const likeDoc = await likesCollection.findOne({ _id: new ObjectId(id) });

      if (!likeDoc) {
        return res.status(404).send({ error: "Like not found" });
      }

      const result = await likesCollection.deleteOne(query);
      const filter = { _id: new ObjectId(likeDoc.postId) };
      const update = {
        $inc: { likes: -1 },
      };
      const likesCount = await lessonsCollection.updateOne(filter, update);
      console.log("result and likesCount", result);
      res.send({ result, likesCount });
    });


    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Sage Server is running");
});
app.listen(port, () => {
  console.log(`Sage is hitting on port ${port}`);
});