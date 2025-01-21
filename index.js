const express = require("express");
const app = express();
const cors = require("cors");
const jwt = require("jsonwebtoken");
const fileUpload = require("express-fileupload");
const ObjectId = require("mongodb").ObjectId;
require("dotenv").config();

const port = process.env.PORT || 65000;

// middleware
app.use(cors());
app.use(express.json());
app.use(fileUpload());

const { MongoClient, ServerApiVersion } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.4c1ex.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  socketTimeoutMS: 30000, // 30 seconds
  connectTimeoutMS: 30000, // 30 seconds
});

async function run() {
  try {
    await client.connect();

    const userCollection = client.db("lms").collection("users");
    const siteCollection = client.db("lms").collection("sites");
    const courseCollection = client.db("lms").collection("courses");

    // jwt related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

    // middlewares
    const verifyToken = (req, res, next) => {
      // console.log('inside verify token', req.headers.authorization);
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "unauthorized access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    // use verify admin after verifyToken
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // users related api
    app.get("/users", verifyToken, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    app.get("/users/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      res.json(user);
    });

    app.get("/users/admin/:email", verifyToken, async (req, res) => {
      const email = req.params.email;

      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const query = { email: email };
      const user = await userCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user?.role === "admin";
      }
      res.send({ admin });
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      // insert user if email doesn't exists
      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "user already exist", insertedId: null });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    app.put("/users/profilePic", async (req, res) => {
      const user = req.body;
      const filter = { email: user.email };
      const pic = req.files.profilePic;
      const picData = pic.data;
      const encodedPic = picData.toString("base64");
      const imageBuffer = Buffer.from(encodedPic, "base64");
      const updateDoc = { $set: { profilePic: imageBuffer } };
      const result = await userCollection.updateOne(filter, updateDoc);
      res.json(result);
    });

    app.put("/users/profile-type", async (req, res) => {
      const { email, profileType } = req.body;
      const filter = { email: email };
      const updateDoc = { $set: { profileType: profileType } };
      const result = await userCollection.updateOne(filter, updateDoc);
      res.json(result);
    });

    app.put("/users-info", async (req, res) => {
      const user = req.body;
      const filter = { email: user.email };
      const options = { upsert: true };
      const updateDoc = { $set: user };
      const result = await userCollection.updateOne(filter, updateDoc, options);
      res.json(result);
    });

    app.delete("/users/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await userCollection.deleteOne(query);
      res.json(result);
    });

    // POST endpoint to create a new site
    app.post("/sites", async (req, res) => {
      const { createdBy, siteName, password, date } = req.body;

      try {
        // Check if the site name already exists
        const existingSite = await siteCollection.findOne({ siteName });

        if (existingSite) {
          return res.status(409).json({ message: "Site name already exists" });
        }

        // Save the new site information, including the password
        const newSite = { createdBy, siteName, password, date };
        const result = await siteCollection.insertOne(newSite);

        if (result.insertedId) {
          res.status(201).json({ insertedId: result.insertedId });
        } else {
          res.status(500).json({ message: "Failed to create the site" });
        }
      } catch (error) {
        res
          .status(500)
          .json({ message: "An error occurred while creating the site." });
      }
    });

    app.get("/sites/:email", verifyToken, async (req, res) => {
      const email = req.params.email;

      try {
        const sites = await siteCollection.find({ createdBy: email }).toArray();
        res.status(200).json(sites);
      } catch (error) {
        res
          .status(500)
          .json({ message: "An error occurred while fetching sites", error });
      }
    });

    // Endpoint to get site details by siteName
    app.get("/sites/by-name/:siteName", verifyToken, async (req, res) => {
      const { siteName } = req.params;

      try {
        // Fetch the site details based on the siteName
        const site = await siteCollection.findOne({ siteName });

        if (!site) {
          return res.status(404).json({ message: "Site not found" });
        }

        // Send back the site details including the siteId
        res.status(200).json({ siteId: site._id, ...site });
      } catch (error) {
        res
          .status(500)
          .json({ message: "An error occurred while fetching site details." });
      }
    });

    app.post("/sites/join", async (req, res) => {
      // const { email } = req.decoded; // Get the email from the decoded token
      const { siteName, password, email } = req.body;

      try {
        // Find the site by name
        const site = await siteCollection.findOne({ siteName });

        // Check if the site exists
        if (!site) {
          return res.status(404).json({ message: "Site not found" });
        }

        // Verify the password
        if (site.password !== password) {
          return res.status(401).json({ message: "Incorrect password" });
        }

        // Check if the user is already a member of the site
        const isAlreadyMember = site.members && site.members.includes(email);
        if (isAlreadyMember) {
          return res
            .status(400)
            .json({ message: "You are already a member of this site" });
        }

        // Update the site document to add the user to the members array
        const updateResult = await siteCollection.updateOne(
          { _id: site._id },
          { $push: { members: email } }
        );

        if (updateResult.modifiedCount === 1) {
          res.status(200).json({ message: "Successfully joined the site" });
        } else {
          res.status(500).json({ message: "Failed to join the site" });
        }
      } catch (error) {
        res
          .status(500)
          .json({ message: "An error occurred while joining the site", error });
      }
    });

    // Express route to get sites a user has joined
    app.get("/sites/joined/:email", verifyToken, async (req, res) => {
      const email = req.params.email;

      if (!email) {
        return res
          .status(400)
          .json({ message: "Email is required to fetch joined sites." });
      }

      try {
        // Find all sites where the user is a member
        const joinedSites = await siteCollection
          .find({ members: email })
          .toArray();

        res.status(200).json(joinedSites);
      } catch (error) {
        console.error("Error fetching joined sites:", error);
        res
          .status(500)
          .json({ message: "An error occurred while fetching joined sites." });
      }
    });

    /////////////// CMS //////////////

    app.get("/sites/:siteName/is-member", async (req, res) => {
      const { siteName } = req.params;
      const { email } = req.query; // Email is passed as a query parameter

      try {
        const site = await siteCollection.findOne({ siteName });

        if (!site) {
          return res.status(404).json({ message: "Site not found" });
        }

        // Check if the user is a member of the site
        const isMember = site.members && site.members.includes(email);

        res.status(200).json({ isMember });
      } catch (error) {
        res.status(500).json({ message: "An error occurred", error });
      }
    });

    // Update Site Home Settings for a Specific Site
    app.put("/sites/:id/home-settings", async (req, res) => {
      const { fullSiteName, shortSiteName, siteSummary } = req.body;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          fullSiteName,
          shortSiteName,
          siteSummary,
        },
      };
      const options = { upsert: false };

      const result = await siteCollection.updateOne(query, updateDoc, options);
      if (result.matchedCount === 0) {
        res.status(404).json({ error: "Site not found" });
      } else {
        res.json(result);
      }
    });

    // Add a new course
    app.post("/courses", async (req, res) => {
      const courseData = req.body;

      // Handle thumbnail
      const pic = req.files?.thumbnail;
      if (!pic) {
        return res.status(400).json({ error: "Thumbnail is required" });
      }

      const picData = pic.data;
      const encodedPic = picData.toString("base64");
      const imageBuffer = Buffer.from(encodedPic, "base64");

      // Prepare course object
      const newCourse = {
        ...courseData,
        thumbnail: imageBuffer,
      };

      const result = await courseCollection.insertOne(newCourse);
      res.json(result);
    });

    app.get("/courses/:originId", verifyToken, async (req, res) => {
      const { originId } = req.params;

      try {
        // Query the database to find courses with the given originId
        const courses = await courseCollection
          .find({ origin: originId })
          .toArray();

        if (courses.length === 0) {
          return res
            .status(404)
            .json({ message: "No courses found for this originId" });
        }

        // Respond with the list of courses
        res.status(200).json(courses);
      } catch (error) {
        console.error("Error fetching courses:", error);
        res
          .status(500)
          .json({ message: "An error occurred while fetching courses", error });
      }
    });

    // Get course by ID
    app.get("/course/:courseId", async (req, res) => {
      const { courseId } = req.params;

      try {
        const course = await courseCollection.findOne({
          _id: new ObjectId(courseId),
        });

        if (!course) {
          return res.status(404).json({ message: "Course not found" });
        }

        res.status(200).json(course);
      } catch (error) {
        console.error("Error fetching course details:", error);
        res.status(500).json({ message: "An error occurred." });
      }
    });

    // Add a Section
    app.post("/course/:courseId/section", async (req, res) => {
      const { courseId } = req.params;
      const { title } = req.body;
      const sectionId = Date.now().toString();

      try {
        const updateResult = await courseCollection.updateOne(
          { _id: new ObjectId(courseId) },
          { $push: { sections: { courseId, sectionId, title, lessons: [] } } }
        );

        if (updateResult.modifiedCount === 0) {
          return res.status(404).json({ message: "Course not found" });
        }

        res.status(201).json({ message: "Section added successfully" });
      } catch (error) {
        console.error("Error adding section:", error);
        res.status(500).json({ message: "An error occurred." });
      }
    });

    // Rename Section
    app.put("/course/:courseId/section/:sectionId", async (req, res) => {
      const { courseId, sectionId } = req.params;
      const { newTitle } = req.body;

      try {
        const course = await courseCollection.findOne({
          _id: new ObjectId(courseId),
        });

        if (!course) {
          return res.status(404).json({ message: "Course not found" });
        }

        const sectionIndex = course.sections.findIndex(
          (section) => section.sectionId.toString() === sectionId
        );

        if (sectionIndex === -1) {
          return res.status(404).json({ message: "Section not found" });
        }

        course.sections[sectionIndex].title = newTitle;

        await courseCollection.updateOne(
          { _id: new ObjectId(courseId) },
          { $set: { sections: course.sections } }
        );

        res.status(200).json({ message: "Section renamed successfully" });
      } catch (error) {
        console.error("Error renaming section:", error);
        res.status(500).json({ message: "Error renaming section" });
      }
    });

    // Delete a Section
    app.delete("/course/:courseId/section/:sectionId", async (req, res) => {
      const { courseId, sectionId } = req.params;

      try {
        const updateResult = await courseCollection.updateOne(
          { _id: new ObjectId(courseId) },
          { $pull: { sections: { sectionId: sectionId } } }
        );

        if (updateResult.modifiedCount === 0) {
          return res.status(404).json({ message: "Section not found" });
        }

        res.status(200).json({ message: "Section deleted successfully" });
      } catch (error) {
        console.error("Error deleting section:", error);
        res.status(500).json({ message: "An error occurred." });
      }
    });

    // Add a Lesson
    app.post(
      "/course/:courseId/section/:sectionId/lesson",
      async (req, res) => {
        const { courseId, sectionId } = req.params;
        const { lessonName } = req.body;

        const lessonId = Date.now().toString();

        try {
          const updateResult = await courseCollection.updateOne(
            {
              _id: new ObjectId(courseId),
              "sections.sectionId": sectionId,
            },
            {
              $push: {
                "sections.$.lessons": {
                  courseId,
                  sectionId,
                  lessonId,
                  name: lessonName,
                },
              },
            }
          );

          if (updateResult.modifiedCount === 0) {
            return res.status(404).json({ message: "Section not found" });
          }

          res.status(201).json({ message: "Lesson added successfully" });
        } catch (error) {
          console.error("Error adding lesson:", error);
          res.status(500).json({ message: "An error occurred." });
        }
      }
    );

    // Rename a Lesson
    app.put(
      "/course/:courseId/section/:sectionId/lesson/:lessonId",
      async (req, res) => {
        const { courseId, sectionId, lessonId } = req.params;
        const { newName } = req.body;

        try {
          const updateResult = await courseCollection.updateOne(
            {
              _id: new ObjectId(courseId),
            },
            {
              $set: {
                "sections.$[section].lessons.$[lesson].name": newName,
              },
            },
            {
              arrayFilters: [
                { "section.sectionId": sectionId },
                { "lesson.lessonId": lessonId },
              ],
            }
          );

          if (updateResult.modifiedCount === 0) {
            return res.status(404).json({ message: "Lesson not found" });
          }

          res.status(200).json({ message: "Lesson renamed successfully" });
        } catch (error) {
          console.error("Error renaming lesson:", error);
          res.status(500).json({ message: "An error occurred." });
        }
      }
    );

    // Delete a Lesson
    app.delete(
      "/course/:courseId/section/:sectionId/lesson/:lessonId",
      async (req, res) => {
        const { courseId, sectionId, lessonId } = req.params;

        try {
          const updateResult = await courseCollection.updateOne(
            {
              _id: new ObjectId(courseId),
            },
            {
              $pull: {
                "sections.$[section].lessons": { lessonId: lessonId },
              },
            },
            {
              arrayFilters: [{ "section.sectionId": sectionId }],
            }
          );

          if (updateResult.modifiedCount === 0) {
            return res.status(404).json({ message: "Lesson not found" });
          }

          res.status(200).json({ message: "Lesson deleted successfully" });
        } catch (error) {
          console.error("Error deleting lesson:", error);
          res.status(500).json({ message: "An error occurred." });
        }
      }
    );

    // video upload
    app.post(
      "/course/:courseId/section/:sectionId/lesson/:lessonId/video",
      async (req, res) => {
        const { courseId, sectionId, lessonId } = req.params;
        const { type, title } = req.body;
        const videoFile = req.files?.file;

        if (!videoFile) {
          return res.status(400).json({ error: "Video file is required" });
        }

        if (!videoFile.mimetype.startsWith("video/")) {
          return res.status(400).json({ error: "File must be a video" });
        }

        // Use the video file's data directly
        const videoBuffer = videoFile.data;

        try {
          const updateResult = await courseCollection.updateOne(
            {
              _id: new ObjectId(courseId),
            },
            {
              // $set: {
              //   "sections.$[section].lessons.$[lesson].type": type, // Add or update `type`
              //   "sections.$[section].lessons.$[lesson].title": title, // Add or update `title`
              //   "sections.$[section].lessons.$[lesson].data": videoBuffer, // Add or update `data`
              // },
              $set: {
                "sections.$[section].lessons.$[lesson].content": {
                  type,
                  title,
                  data: videoBuffer,
                },
              },
            },
            {
              arrayFilters: [
                { "section.sectionId": sectionId },
                { "lesson.lessonId": lessonId },
              ],
            }
          );

          if (updateResult.modifiedCount === 0) {
            return res.status(404).json({ message: "Lesson not found" });
          }

          res.status(200).json({ message: "Video uploaded successfully" });
        } catch (error) {
          console.error("Error uploading video:", error);
          res.status(500).json({ message: "An error occurred." });
        }
      }
    );

    // Delete lesson content
    app.delete(
      "/course/:courseId/section/:sectionId/lesson/:lessonId/content",
      async (req, res) => {
        const { courseId, sectionId, lessonId } = req.params;

        console.log(req.params);

        try {
          const updateResult = await courseCollection.updateOne(
            { _id: new ObjectId(courseId) },
            {
              $unset: {
                "sections.$[section].lessons.$[lesson].content": "",
              },
            },
            {
              arrayFilters: [
                { "section.sectionId": sectionId },
                { "lesson.lessonId": lessonId },
              ],
            }
          );

          if (updateResult.modifiedCount === 0) {
            return res.status(404).json({ message: "Lesson not found" });
          }

          res.status(200).json({ message: "Lesson deleted successfully!" });
        } catch (error) {
          console.error("Error deleting lesson:", error);
          res.status(500).json({ message: "An error occurred." });
        }
      }
    );

    //////////
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Ema jon server is running and running");
});

app.listen(port, () => {
  console.log("Server running at port", port);
});
