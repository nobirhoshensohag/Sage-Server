const express = require("express");
const app = express();
require("dotenv").config();
const port = process.env.PORT || 5000;
const admin = require("firebase-admin");

const serviceAccount = require("./firebase-admin.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const cors = require("cors");
app.use(cors());
app.use(express.json());

const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);

    req.decoded_email = decoded.email;
    next();
  } catch (err) {
    return res.status(401).send({ message: "unauthorized access" });
  }
};

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_NAME}:${process.env.DB_PASS}@cluster1.h19g7bt.mongodb.net/?appName=Cluster1`;
const stripe = require("stripe")(process.env.STRIPE_SECRET);
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
    // Connect the client to the server	(optional starting in v4.7)
    const db = client.db("sage");
    const usersCollection = db.collection("users");
    const lessonsCollection = db.collection("lessons");
    const favoritesCollection = db.collection("favorites");
    const likesCollection = db.collection("likes");
    const reportsCollection = db.collection("reports");

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await usersCollection.findOne(query);

      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }

      next();
    };

    //users related apis
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

    app.patch("/users/:id", verifyFBToken, async (req, res) => {
      const userId = req.params.id;
      const { displayName, photoURL } = req.body;
      const userQuery = { _id: new ObjectId(userId) };

      try {
        const userUpdateResult = await usersCollection.updateOne(userQuery, {
          $set: req.body,
        });

        const updatedUser = await usersCollection.findOne(userQuery);
        const userEmail = updatedUser.email;

        await lessonsCollection.updateMany(
          { email: userEmail },
          {
            $set: { authorImage: photoURL, name: displayName },
          }
        );
        await favoritesCollection.updateMany(
          { posterEmail: userEmail },
          { $set: { posterName: displayName, posterImage: photoURL } }
        );

        await likesCollection.updateMany(
          { posterEmail: userEmail },
          { $set: { posterName: displayName, posterImage: photoURL } }
        );

        await lessonsCollection.updateMany(
          { "comments.commenterEmail": userEmail },
          {
            $set: {
              "comments.$[elem].commenter": displayName,
              "comments.$[elem].commenterImage": photoURL,
            },
          },
          {
            arrayFilters: [{ "elem.commenterEmail": userEmail }],
            multi: true,
          }
        );

        res.send({
          success: true,
          message: "User and all references updated successfully",
          userUpdateResult,
        });
      } catch (error) {
        console.error(error);
        res
          .status(500)
          .send({ success: false, message: "Update failed", error });
      }
    });
    app.patch(
      "/users/:id/role",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        const { role } = req.body;

        if (!["admin", "user"].includes(role)) {
          return res.status(400).send({ message: "Invalid role" });
        }

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role } }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "User not found" });
        }

        res.send({
          success: true,
          message: `User role updated to ${role}`,
        });
      }
    );

    //lessons related apis
    app.post("/lessons", verifyFBToken, async (req, res) => {
      const lesson = req.body;
      lesson.comments = [];
      lesson.likes = 0;
      lesson.favorites = 0;
      lesson.postedAt = new Date();
      lesson.isFeatured = "false";
      lesson.status = "pending";

      const result = await lessonsCollection.insertOne(lesson);
      res.send(result);
    });
    app.get("/lessons", async (req, res) => {
      const {
        isPrivate,
        tone,
        category,
        email,
        limit = 0,
        skip = 0,
        sort = "postedAt",
        search = "",
        isFeatured,
        status,
      } = req.query;

      const query = {};
      const sortOption = {};
      sortOption[sort || "postedAt"] = -1;
      if (status) {
        query.status = status;
      }
      if (isPrivate) {
        query.isPrivate = isPrivate;
      }
      if (isFeatured) {
        query.isFeatured = isFeatured;
      }
      if (email) {
        query.email = email;
      }
      if (tone) {
        query.tone = tone;
      }
      if (category) {
        query.category = category;
      }
      if (search) {
        query.title = { $regex: search, $options: "i" };
      }

      const result = await lessonsCollection
        .find(query)
        .sort(sortOption)
        .limit(Number(limit))
        .skip(Number(skip))
        .toArray();

      const count = await lessonsCollection.countDocuments(query);
      res.send({ result, total: count });
    });
    app.get("/top-contributors-week", async (req, res) => {
      try {
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

        const lessons = await lessonsCollection
          .find({ postedAt: { $gte: oneWeekAgo } })
          .toArray();

        const freq = {};
        lessons.forEach((lesson) => {
          const email = lesson.email;
          if (!freq[email]) {
            freq[email] = {
              email: lesson.email,
              name: lesson.name,
              authorImage: lesson.authorImage,
              count: 0,
            };
          }
          freq[email].count++;
        });

        let contributors = Object.values(freq)
          .sort((a, b) => b.count - a.count)
          .slice(0, 4); //top 4

        contributors = await Promise.all(
          contributors.map(async (contributor) => {
            const user = await usersCollection.findOne({
              email: contributor.email,
            });
            return {
              ...contributor,
              isPremium: user?.isPremium ? "true" : "false",
            };
          })
        );

        res.send({ contributors });
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: "Something went wrong" });
      }
    });

    app.get("/lessons/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await lessonsCollection.findOne(query);
      res.send(result);
    });
    app.patch("/lessons/:id", verifyFBToken, async (req, res) => {
      const updatedLesson = req.body;
      updatedLesson.postedAt = new Date();
      updatedLesson.commentedAt = new Date();
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const update = {
        $addToSet: {
          comments: updatedLesson,
        },
      };
      const result = await lessonsCollection.updateOne(query, update);
      res.send(result);
    });
    app.patch(
      "/lessons/:id/status",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { id } = req.params;
          const { status } = req.body;

          // Validate status
          const allowedStatus = ["pending", "approved", "rejected"];
          if (!allowedStatus.includes(status)) {
            return res.status(400).send({ message: "Invalid status value" });
          }

          const result = await lessonsCollection.updateOne(
            { _id: new ObjectId(id) },
            {
              $set: {
                status,
                statusUpdatedAt: new Date(),
              },
            }
          );

          if (result.matchedCount === 0) {
            return res.status(404).send({ message: "Lesson not found" });
          }

          res.send({
            success: true,
            message: `Lesson status updated to ${status}`,
          });
        } catch (error) {
          console.error("Status update error:", error);
          res.status(500).send({ message: "Failed to update lesson status" });
        }
      }
    );
    app.patch(
      "/lessons/:id/featured",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { id } = req.params;
          const { isFeatured } = req.body;

          const result = await lessonsCollection.updateOne(
            { _id: new ObjectId(id) },
            {
              $set: {
                isFeatured,
                featuredAt: new Date(),
              },
            }
          );

          if (result.matchedCount === 0) {
            return res.status(404).send({ message: "Lesson not found" });
          }

          res.send({ success: true, isFeatured });
        } catch (error) {
          console.error("Feature update failed", error);
          res.status(500).send({ message: "Failed to update featured status" });
        }
      }
    );
    app.patch("/lessons/:id/edit", verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const updatedLesson = req.body;

      const result = await lessonsCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            title: updatedLesson.title,
            description: updatedLesson.description,
            category: updatedLesson.category,
            tone: updatedLesson.tone,
            isPrivate: updatedLesson.isPrivate,
            isPremiumAccess: updatedLesson.isPremiumAccess,
            image: updatedLesson.image,
            updatedAt: new Date(),
          },
        }
      );

      res.send(result);
    });

    app.delete("/lessons/:id", verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await lessonsCollection.deleteOne(query);
      const deleteLikes = await likesCollection.deleteMany({
        postId: id,
      });
      const deleteFavorites = await favoritesCollection.deleteMany({
        postId: id,
      });
      res.send({ result, deleteLikes, deleteFavorites });
    });

    //favorite related apis
    app.post("/favorites", verifyFBToken, async (req, res) => {
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
    app.patch("/favorites/:postId", verifyFBToken, async (req, res) => {
      const postId = req.params.postId;
      const query = { postId: postId };
      const { title, image } = req.body;
      const update = {
        $set: { postTitle: title, postImage: image },
      };
      const result = await favoritesCollection.updateMany(query, update);
      res.send(result);
    });
    app.delete("/favorites/:id", verifyFBToken, async (req, res) => {
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

      res.send({ result, favoritesCount });
    });

    //likes related apis
    app.post("/likes", verifyFBToken, async (req, res) => {
      const like = req.body;
      like.likedAt = new Date();

      const result = await likesCollection.insertOne(like);
      const filter = { _id: new ObjectId(like.postId) };
      const update = {
        $inc: { likes: 1 },
      };
      const likesCount = await lessonsCollection.updateOne(filter, update);

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

      res.send(result);
    });
    app.get("/likes/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await likesCollection.findOne(query);
      res.send(result);
    });

    app.delete("/likes/:id", verifyFBToken, async (req, res) => {
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

      res.send({ result, likesCount });
    });

    //reports related apis
    app.post("/reports", verifyFBToken, async (req, res) => {
      const report = req.body;
      report.reportedAt = new Date();
      const result = await reportsCollection.insertOne(report);
      res.send(result);
    });
    app.get("/reports", verifyFBToken, verifyAdmin, async (req, res) => {
      const result = await reportsCollection.find().toArray();
      res.send(result);
    });
    app.delete("/reports/:id", verifyFBToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await reportsCollection.deleteOne(query);
      res.send(result);
    });

    //payment related apis
    app.post("/payment-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "bdt",
              unit_amount: 150000,
              product_data: { name: "Be a Premium Member" },
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        metadata: {
          email: paymentInfo.email,
          displayName: paymentInfo.displayName,
          photoURL: paymentInfo.photoURL,
        },
        customer_email: paymentInfo.email,
        success_url: `${process.env.SITE_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/payment-cancelled`,
      });
      res.send({ url: session.url });
    });

    // await client.connect();
    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
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