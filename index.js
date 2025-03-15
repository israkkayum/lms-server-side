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
    strict: false, // Changed from true to false to allow commands not in API Version 1
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
    const progressCollection = client.db("lms").collection("courseProgress");
    const assignmentSubmissionCollection = client
      .db("lms")
      .collection("assignmentSubmissions");
    const quizSubmissionCollection = client
      .db("lms")
      .collection("quizSubmissions");
    const forumTopicsCollection = client.db("lms").collection("forumTopics");
    const forumRepliesCollection = client.db("lms").collection("forumReplies");
    const blogCollection = client.db("lms").collection("blogs");

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

    // PATCH endpoint to update site homepage content
    app.put("/sites/:id/announcements", verifyToken, async (req, res) => {
      const { id } = req.params;
      const { announcements } = req.body;

      // Validate request body
      if (!announcements || !Array.isArray(announcements)) {
        return res.status(400).json({
          message: "Invalid request body. 'announcements' must be an array",
        });
      }

      // Validate each announcement object
      for (const announcement of announcements) {
        if (!announcement.title || !announcement.content) {
          return res.status(400).json({
            message: "Each announcement must have a title and content",
          });
        }
      }

      try {
        const result = await siteCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { announcements } }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "Site not found" });
        }

        if (result.modifiedCount === 1) {
          res.status(200).json({
            message: "Announcements updated successfully",
            count: announcements.length,
          });
        } else {
          res.status(400).json({ message: "No changes were made" });
        }
      } catch (error) {
        console.error("Error updating announcements:", error);
        res.status(500).json({ message: "Failed to update announcements" });
      }
    });

    // Delete a specific announcement
    app.delete(
      "/sites/:id/announcements/:index",
      verifyToken,
      async (req, res) => {
        const { id, index } = req.params;

        try {
          // First, get the current site and its announcements
          const site = await siteCollection.findOne({ _id: new ObjectId(id) });

          if (!site) {
            return res.status(404).json({ message: "Site not found" });
          }

          if (!site.announcements || !Array.isArray(site.announcements)) {
            return res.status(400).json({ message: "No announcements found" });
          }

          const announcementIndex = parseInt(index);
          if (
            isNaN(announcementIndex) ||
            announcementIndex < 0 ||
            announcementIndex >= site.announcements.length
          ) {
            return res
              .status(400)
              .json({ message: "Invalid announcement index" });
          }

          // Remove the announcement at the specified index
          const updatedAnnouncements = site.announcements.filter(
            (_, i) => i !== announcementIndex
          );

          // Update the site with the new announcements array
          const result = await siteCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { announcements: updatedAnnouncements } }
          );

          if (result.modifiedCount === 1) {
            res.status(200).json({
              message: "Announcement deleted successfully",
              remainingCount: updatedAnnouncements.length,
            });
          } else {
            res.status(400).json({ message: "Failed to delete announcement" });
          }
        } catch (error) {
          console.error("Error deleting announcement:", error);
          res.status(500).json({ message: "Failed to delete announcement" });
        }
      }
    );

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

    // Update course settings
    app.put("/courses/:id", async (req, res) => {
      const courseId = req.params.id;
      const { courseName, courseDescription, courseCategory, courseTags } =
        req.body;

      try {
        const query = { _id: new ObjectId(courseId) };
        const updateDoc = {
          $set: {
            courseName,
            courseDescription,
            courseCategory,
            courseTags,
            updatedAt: new Date(),
          },
        };

        // Handle thumbnail if uploaded
        if (req.files?.thumbnail) {
          const pic = req.files.thumbnail;
          const picData = pic.data;
          const encodedPic = picData.toString("base64");
          const imageBuffer = Buffer.from(encodedPic, "base64");
          updateDoc.$set.thumbnail = imageBuffer;
        }

        const result = await courseCollection.updateOne(query, updateDoc);

        if (result.matchedCount === 0) {
          return res.status(404).json({ error: "Course not found" });
        }

        res.json({ acknowledged: true });
      } catch (error) {
        console.error("Error updating course:", error);
        res
          .status(500)
          .json({ error: "An error occurred while updating the course" });
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

    // video upload endpoint
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

    // assignment upload
    app.post(
      "/course/:courseId/section/:sectionId/lesson/:lessonId/assignment",
      async (req, res) => {
        const { courseId, sectionId, lessonId } = req.params;
        const { type, title, description, id } = req.body;

        if (!title) {
          return res.status(400).json({ error: "Title is required." });
        }

        try {
          const updateResult = await courseCollection.updateOne(
            { _id: new ObjectId(courseId) },
            {
              $set: {
                "sections.$[section].lessons.$[lesson].content": {
                  type,
                  title,
                  description,
                  id,
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
            return res.status(404).json({ message: "Lesson not found." });
          }

          res.status(200).json({ message: "Assignment updated successfully." });
        } catch (error) {
          console.error("Error updating assignment:", error);
          res.status(500).json({ message: "An error occurred." });
        }
      }
    );

    // article upload endpoint
    app.post(
      "/course/:courseId/section/:sectionId/lesson/:lessonId/article",
      async (req, res) => {
        const { courseId, sectionId, lessonId } = req.params;
        const { type, title, content } = req.body;

        if (!title) {
          return res.status(400).json({ error: "Title is required." });
        }

        try {
          const updateResult = await courseCollection.updateOne(
            { _id: new ObjectId(courseId) },
            {
              $set: {
                "sections.$[section].lessons.$[lesson].content": {
                  type,
                  title,
                  content,
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
            return res.status(404).json({ message: "Lesson not found." });
          }

          res.status(200).json({ message: "Assignment updated successfully." });
        } catch (error) {
          console.error("Error updating assignment:", error);
          res.status(500).json({ message: "An error occurred." });
        }
      }
    );

    // Course Progress API Endpoints
    app.get(
      "/course-progress/:courseId/:email",
      verifyToken,
      async (req, res) => {
        const { courseId, email } = req.params;

        try {
          const progress = await progressCollection.findOne({
            courseId,
            userEmail: email,
          });

          if (!progress) {
            return res.json({
              completedLessons: [],
              progress: 0,
            });
          }

          res.json(progress);
        } catch (error) {
          console.error("Error fetching course progress:", error);
          res.status(500).json({ message: "Error fetching course progress" });
        }
      }
    );

    app.post(
      "/course-progress/:courseId/:email",
      verifyToken,
      async (req, res) => {
        const { courseId, email } = req.params;
        const { lessonId, completed, timestamp } = req.body;

        try {
          const updateOperation = completed
            ? { $addToSet: { completedLessons: lessonId } }
            : { $pull: { completedLessons: lessonId } };

          const result = await progressCollection.updateOne(
            { courseId, userEmail: email },
            {
              ...updateOperation,
              $set: { lastUpdated: timestamp },
              $setOnInsert: { startedAt: timestamp },
            },
            { upsert: true }
          );

          // Calculate and update progress percentage
          const course = await courseCollection.findOne({
            _id: new ObjectId(courseId),
          });

          const totalLessons = course.sections.reduce(
            (total, section) => total + section.lessons.length,
            0
          );

          const progress = await progressCollection.findOne({
            courseId,
            userEmail: email,
          });

          const progressPercentage =
            (progress.completedLessons.length / totalLessons) * 100;

          await progressCollection.updateOne(
            { courseId, userEmail: email },
            { $set: { progress: progressPercentage } }
          );

          res.json({ success: true, progress: progressPercentage });
        } catch (error) {
          console.error("Error updating course progress:", error);
          res.status(500).json({ message: "Error updating course progress" });
        }
      }
    );

    // Resources upload endpoint
    app.post(
      "/course/:courseId/section/:sectionId/lesson/:lessonId/resources",
      async (req, res) => {
        const { courseId, sectionId, lessonId } = req.params;
        const { title, type } = req.body;

        if (!req.files || !req.files.files) {
          return res.status(400).json({ message: "No files were uploaded" });
        }

        // Handle both single file and multiple files
        const uploadedFiles = Array.isArray(req.files.files)
          ? req.files.files
          : [req.files.files];

        try {
          // Process each file
          const resources = uploadedFiles.map((file) => ({
            filename: file.name,
            filesize: file.size,
            mimetype: file.mimetype,
            data: file.data,
          }));

          // Update the lesson with resources
          const updateResult = await courseCollection.updateOne(
            { _id: new ObjectId(courseId) },
            {
              $set: {
                "sections.$[section].lessons.$[lesson].content": {
                  title,
                  type,
                  files: resources,
                  uploadedAt: new Date(),
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

          res.status(200).json({
            message: "Resources uploaded successfully!",
            filesCount: resources.length,
          });
        } catch (error) {
          console.error("Error uploading resources:", error);
          res
            .status(500)
            .json({ message: "An error occurred while uploading resources" });
        }
      }
    );

    // Quiz upload endpoint
    app.post(
      "/course/:courseId/section/:sectionId/lesson/:lessonId/quiz",
      async (req, res) => {
        const { courseId, sectionId, lessonId } = req.params;
        const { title, type, questions, id } = req.body;

        if (!title) {
          return res.status(400).json({ error: "Quiz title is required." });
        }

        if (!questions || !Array.isArray(questions) || questions.length === 0) {
          return res
            .status(400)
            .json({ error: "At least one question is required." });
        }

        try {
          const updateResult = await courseCollection.updateOne(
            { _id: new ObjectId(courseId) },
            {
              $set: {
                "sections.$[section].lessons.$[lesson].content": {
                  type,
                  title,
                  questions,
                  id,
                  createdAt: new Date(),
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
            return res.status(404).json({ message: "Lesson not found." });
          }

          res.status(200).json({ message: "Quiz uploaded successfully!" });
        } catch (error) {
          console.error("Error uploading quiz:", error);
          res
            .status(500)
            .json({ message: "An error occurred while uploading the quiz." });
        }
      }
    );

    // update lesson contents
    app.patch(
      "/course/:courseId/section/:sectionId/lesson/:lessonId/content",
      async (req, res) => {
        const { courseId, sectionId, lessonId } = req.params;
        const {
          title,
          type,
          questions,
          description,
          id,
          content,
          existingFiles,
        } = req.body;
        let updateFields = {};

        if (!title) {
          return res.status(400).json({ error: "Title is required." });
        }

        // Create a content object that we'll build based on the type and provided data
        let contentObject = { title, type };

        // Add fields based on content type
        if (description !== undefined) {
          contentObject.description = description;
          contentObject.id = id;
        }

        if (content !== undefined) {
          contentObject.content = content;
        }

        if (type === "quiz") {
          if (
            !questions ||
            !Array.isArray(questions) ||
            questions.length === 0
          ) {
            return res
              .status(400)
              .json({ error: "At least one question is required." });
          }
          contentObject.questions = questions;
          contentObject.id = id;
          contentObject.updatedAt = new Date();
        }

        // Handle resource files
        let parsedExistingFiles = [];
        try {
          parsedExistingFiles = existingFiles ? JSON.parse(existingFiles) : [];
        } catch (error) {
          console.error("Error parsing existing files:", error);
        }

        let newResources = [];
        if (req.files && req.files.files) {
          const uploadedFiles = Array.isArray(req.files.files)
            ? req.files.files
            : [req.files.files];

          newResources = uploadedFiles.map((file) => ({
            filename: file.name,
            filesize: file.size,
            mimetype: file.mimetype,
            data: file.data,
          }));
        }

        const allResources = [...parsedExistingFiles, ...newResources];
        if (allResources.length > 0) {
          contentObject.files = allResources;
        }

        // Set the entire content object at once
        updateFields["sections.$[section].lessons.$[lesson].content"] =
          contentObject;

        try {
          const updateResult = await courseCollection.updateOne(
            { _id: new ObjectId(courseId) },
            { $set: updateFields },
            {
              arrayFilters: [
                { "section.sectionId": sectionId },
                { "lesson.lessonId": lessonId },
              ],
            }
          );

          if (updateResult.matchedCount === 0) {
            return res.status(404).json({ message: "Lesson not found." });
          }

          res.status(200).json({
            message: "Content updated successfully!",
            filesCount: allResources.length,
          });
        } catch (error) {
          console.error("Error updating content:", error);
          res
            .status(500)
            .json({ message: "An error occurred while updating content." });
        }
      }
    );

    // Delete lesson content
    app.delete(
      "/course/:courseId/section/:sectionId/lesson/:lessonId/content",
      async (req, res) => {
        const { courseId, sectionId, lessonId } = req.params;

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

    // Delete course by ID
    app.delete("/courses/:id", async (req, res) => {
      const courseId = req.params.id;

      try {
        const query = { _id: new ObjectId(courseId) };
        const result = await courseCollection.deleteOne(query);

        if (result.deletedCount === 1) {
          res.json({ acknowledged: true });
        } else {
          res.status(404).json({ error: "Course not found" });
        }
      } catch (error) {
        console.error("Error deleting course:", error);
        res
          .status(500)
          .json({ error: "An error occurred while deleting the course" });
      }
    });

    // Assignment submission endpoint
    app.post("/assignments/submit", async (req, res) => {
      try {
        if (!req.files || !req.files.file) {
          return res.status(400).json({ message: "No file uploaded" });
        }

        const { assignmentId, courseId, sectionId, lessonId, email } = req.body;
        const file = req.files.file;
        const studentEmail = email;

        // Validate file size (10MB limit)
        if (file.size > 10 * 1024 * 1024) {
          return res
            .status(400)
            .json({ message: "File size must be less than 10MB" });
        }

        // Validate file type
        const allowedTypes = [".pdf", ".doc", ".docx", ".zip"];
        const fileExtension = file.name
          .substring(file.name.lastIndexOf("."))
          .toLowerCase();
        if (!allowedTypes.includes(fileExtension)) {
          return res.status(400).json({ message: "Invalid file type" });
        }

        // Convert file to base64
        const fileData = file.data;
        const encodedFile = fileData.toString("base64");
        const fileBuffer = Buffer.from(encodedFile, "base64");

        // Create submission document
        const submission = {
          assignmentId,
          courseId,
          sectionId,
          lessonId,
          studentEmail,
          fileName: file.name,
          fileType: fileExtension,
          fileSize: file.size,
          fileData: fileBuffer,
          submittedAt: new Date(),
        };

        const result = await assignmentSubmissionCollection.insertOne(
          submission
        );

        if (result.insertedId) {
          res
            .status(201)
            .json({ message: "Assignment submitted successfully" });
        } else {
          res.status(500).json({ message: "Failed to submit assignment" });
        }
      } catch (error) {
        console.error("Assignment submission error:", error);
        res.status(500).json({ message: "Error submitting assignment" });
      }
    });

    // Get assignment submissions for a specific assignment
    app.get("/assignments/:assignmentId/submissions", async (req, res) => {
      try {
        const { assignmentId } = req.params;
        const submissions = await assignmentSubmissionCollection
          .find({ assignmentId })
          .toArray();

        res.status(200).json(submissions);
      } catch (error) {
        console.error("Error fetching submissions:", error);
        res.status(500).json({ message: "Error fetching submissions" });
      }
    });

    // Mark assignment submission
    app.post(
      "/assignments/:assignmentId/submissions/:submissionId/mark",
      verifyToken,
      async (req, res) => {
        try {
          const { assignmentId, submissionId } = req.params;
          const { score, feedback } = req.body;

          // Validate score
          if (score < 0 || score > 100) {
            return res
              .status(400)
              .json({ message: "Score must be between 0 and 100" });
          }

          // Update submission with score and feedback
          const result = await assignmentSubmissionCollection.updateOne(
            { _id: new ObjectId(submissionId), assignmentId },
            { $set: { score, feedback, markedAt: new Date() } }
          );

          if (result.matchedCount === 0) {
            return res.status(404).json({ message: "Submission not found" });
          }

          if (result.modifiedCount === 1) {
            res.status(200).json({ message: "Assignment marked successfully" });
          } else {
            res.status(500).json({ message: "Failed to mark assignment" });
          }
        } catch (error) {
          console.error("Error marking assignment:", error);
          res.status(500).json({ message: "Error marking assignment" });
        }
      }
    );

    // Get submission by assignment ID and user email
    app.get(
      "/assignments/:assignmentId/submission/:email",
      async (req, res) => {
        try {
          const { assignmentId, email } = req.params;

          const submission = await assignmentSubmissionCollection.findOne({
            assignmentId,
            studentEmail: email,
          });

          if (!submission) {
            return res.status(404).json({ message: "No submission found" });
          }

          // Exclude the file data from the response for better performance
          const { fileData, ...submissionWithoutFile } = submission;

          res.status(200).json(submissionWithoutFile);
        } catch (error) {
          console.error("Error fetching submission:", error);
          res.status(500).json({ message: "Error fetching submission" });
        }
      }
    );

    // Quiz submission endpoint
    app.post("/quiz-submissions", async (req, res) => {
      try {
        const {
          courseId,
          sectionId,
          lessonId,
          userId,
          quizId,
          score,
          answers,
          totalQuestions,
          correctAnswers,
        } = req.body;

        // Validate required fields
        if (!userId || !quizId || score === undefined || !answers) {
          return res.status(400).json({
            message:
              "Missing required fields. Please provide userId, quizId, score, and answers",
          });
        }

        // Validate score is a number between 0 and 100
        if (typeof score !== "number" || score < 0 || score > 100) {
          return res.status(400).json({
            message: "Score must be a number between 0 and 100",
          });
        }

        // Create submission document
        const submission = {
          courseId,
          sectionId,
          lessonId,
          userId,
          quizId,
          score,
          answers,
          totalQuestions,
          correctAnswers,
          submittedAt: new Date(),
        };

        const result = await quizSubmissionCollection.insertOne(submission);

        if (result.insertedId) {
          res.status(201).json({
            message: "Quiz submitted successfully",
            submissionId: result.insertedId,
          });
        } else {
          res.status(500).json({ message: "Failed to submit quiz" });
        }
      } catch (error) {
        console.error("Quiz submission error:", error);
        res.status(500).json({ message: "Error submitting quiz" });
      }
    });

    app.get("/quiz-submissions/:quizId/:userId", async (req, res) => {
      try {
        const { userId, quizId } = req.params;

        const submission = await quizSubmissionCollection.findOne({
          userId,
          quizId,
        });

        if (!submission) {
          return res.status(404).json({
            message: "No submission found for this quiz",
          });
        }

        res.json(submission);
      } catch (error) {
        console.error("Error retrieving quiz submission:", error);
        res.status(500).json({
          message: "Failed to retrieve quiz submission",
        });
      }
    });

    // Delete quiz submission endpoint
    app.delete("/quiz-submissions/:quizId/:userId", async (req, res) => {
      try {
        const { quizId, userId } = req.params;

        // Delete the submission
        const result = await quizSubmissionCollection.deleteOne({
          quizId,
          userId,
        });

        if (result.deletedCount === 1) {
          res
            .status(200)
            .json({ message: "Quiz submission deleted successfully" });
        } else {
          res.status(404).json({ message: "Quiz submission not found" });
        }
      } catch (error) {
        console.error("Error deleting quiz submission:", error);
        res.status(500).json({ message: "Failed to delete quiz submission" });
      }
    });

    // Get grades for a course
    app.get("/grades/:courseId", async (req, res) => {
      try {
        const { courseId } = req.params;
        const { email } = req.query;

        if (!email) {
          return res.status(400).json({ message: "Email is required" });
        }

        // Get all assignments for this course
        const assignments = await assignmentSubmissionCollection
          .find({
            courseId,
            studentEmail: email,
          })
          .toArray();

        // Get all quizzes for this course
        const quizzes = await quizSubmissionCollection
          .find({
            courseId,
            userId: email,
          })
          .toArray();

        // Format assignment data
        const formattedAssignments = assignments.map((assignment) => ({
          title: "Assignment",
          score: assignment.score || 0,
          maxScore: 10,
          submissionDate: assignment.submittedAt,
          feedback: assignment.feedback || "",
        }));

        // Format quiz data
        const formattedQuizzes = quizzes.map((quiz) => ({
          title: "Quiz",
          score: quiz.score || 0,
          maxScore: 100,
          submissionDate: quiz.submittedAt,
          feedback: "",
        }));

        // Calculate overall grade
        let overallGrade = "N/A";
        const totalSubmissions =
          formattedAssignments.length + formattedQuizzes.length;

        if (totalSubmissions > 0) {
          // Normalize assignment scores to 100-point scale
          const normalizedAssignmentScores = formattedAssignments.map(
            (a) => (a.score / a.maxScore) * 100
          );

          // Combine all scores
          const allScores = [
            ...normalizedAssignmentScores,
            ...quizzes.map((q) => q.score),
          ];

          // Calculate average
          const averageScore =
            allScores.reduce((sum, score) => sum + score, 0) / allScores.length;

          overallGrade = averageScore.toFixed(1) + "%";
        }

        res.json({
          assignments: formattedAssignments,
          quizzes: formattedQuizzes,
          overallGrade,
        });
      } catch (error) {
        console.error("Error fetching grades:", error);
        res.status(500).json({ message: "Error fetching grades" });
      }
    });

    // Forum related APIs
    app.get("/forum-topics", async (req, res) => {
      try {
        const topics = await forumTopicsCollection.find().toArray();
        res.json(topics);
      } catch (error) {
        res.status(500).json({ error: "Failed to fetch forum topics" });
      }
    });

    app.post("/forum-topics", async (req, res) => {
      try {
        const topic = req.body;
        topic.createdAt = new Date();
        topic.replies = 0;
        topic.views = 0;
        const result = await forumTopicsCollection.insertOne(topic);
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: "Failed to create forum topic" });
      }
    });

    app.get("/forum-topics/:topicId", async (req, res) => {
      try {
        const topicId = req.params.topicId;
        const topic = await forumTopicsCollection.findOne({
          _id: new ObjectId(topicId),
        });

        if (!topic) {
          return res.status(404).json({ error: "Topic not found" });
        }

        // Increment views count
        await forumTopicsCollection.updateOne(
          { _id: new ObjectId(topicId) },
          { $inc: { views: 1 } }
        );

        // Return the updated topic
        const updatedTopic = await forumTopicsCollection.findOne({
          _id: new ObjectId(topicId),
        });
        res.json(updatedTopic);
      } catch (error) {
        console.error("Error fetching topic:", error);
        res.status(500).json({ error: "Failed to fetch forum topic" });
      }
    });

    app.get("/forum-replies/:topicId", async (req, res) => {
      try {
        const topicId = req.params.topicId;
        const replies = await forumRepliesCollection
          .find({ topicId: new ObjectId(topicId) })
          .toArray();
        res.json(replies);
      } catch (error) {
        res.status(500).json({ error: "Failed to fetch replies" });
      }
    });

    app.post("/forum-replies", async (req, res) => {
      try {
        const reply = req.body;
        reply.createdAt = new Date();
        reply.topicId = new ObjectId(reply.topicId);
        const result = await forumRepliesCollection.insertOne(reply);
        await forumTopicsCollection.updateOne(
          { _id: reply.topicId },
          { $inc: { replies: 1 } }
        );
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: "Failed to create reply" });
      }
    });

    // Delete a forum topic
    app.delete("/forum-topics/:id", verifyToken, async (req, res) => {
      try {
        const topicId = req.params.id;
        const topic = await forumTopicsCollection.findOne({
          _id: new ObjectId(topicId),
        });

        if (!topic) {
          return res.status(404).json({ error: "Topic not found" });
        }

        // Check if the user is the author of the topic
        if (topic.author !== req.decoded.email) {
          return res
            .status(403)
            .json({ error: "You are not authorized to delete this topic" });
        }

        // Delete all replies associated with this topic
        await forumRepliesCollection.deleteMany({
          topicId: new ObjectId(topicId),
        });

        // Delete the topic
        const result = await forumTopicsCollection.deleteOne({
          _id: new ObjectId(topicId),
        });

        res.json(result);
      } catch (error) {
        console.error("Error deleting topic:", error);
        res.status(500).json({ error: "Failed to delete topic" });
      }
    });
    // Delete a forum reply
    app.delete("/forum-replies/:id", verifyToken, async (req, res) => {
      try {
        const replyId = req.params.id;
        const reply = await forumRepliesCollection.findOne({
          _id: new ObjectId(replyId),
        });

        if (!reply) {
          return res.status(404).json({ error: "Reply not found" });
        }

        // Check if the user is the author of the reply
        if (reply.author !== req.decoded.email) {
          return res
            .status(403)
            .json({ error: "You are not authorized to delete this reply" });
        }

        // Decrement the reply count in the topic
        await forumTopicsCollection.updateOne(
          { _id: reply.topicId },
          { $inc: { replies: -1 } }
        );

        // Delete the reply
        const result = await forumRepliesCollection.deleteOne({
          _id: new ObjectId(replyId),
        });

        res.json(result);
      } catch (error) {
        console.error("Error deleting reply:", error);
        res.status(500).json({ error: "Failed to delete reply" });
      }
    });

    // Blog related APIs
    // Get all blogs with optional filtering
    app.get("/blogs", async (req, res) => {
      try {
        const { category, search, page = 1, limit = 6 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Build query based on filters
        let query = {};
        if (category) query.category = category;
        if (search) {
          query = {
            ...query,
            $or: [
              { title: { $regex: search, $options: "i" } },
              { content: { $regex: search, $options: "i" } },
            ],
          };
        }

        // Get total count for pagination
        const total = await blogCollection.countDocuments(query);

        // Get blogs with pagination
        const blogs = await blogCollection
          .find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .toArray();

        // Get unique categories for filtering
        const categories = await blogCollection.distinct("category");

        res.json({
          blogs,
          pagination: {
            total,
            totalPages: Math.ceil(total / parseInt(limit)),
            currentPage: parseInt(page),
            limit: parseInt(limit),
          },
          categories,
        });
      } catch (error) {
        console.error("Error fetching blogs:", error);
        res.status(500).json({ message: "Failed to fetch blogs" });
      }
    });

    // Get a single blog by ID
    app.get("/blogs/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const blog = await blogCollection.findOne({ _id: new ObjectId(id) });

        if (!blog) {
          return res.status(404).json({ message: "Blog not found" });
        }

        // Increment view count
        await blogCollection.updateOne(
          { _id: new ObjectId(id) },
          { $inc: { views: 1 } }
        );

        // Get related blogs (same category)
        const relatedBlogs = await blogCollection
          .find({
            category: blog.category,
            _id: { $ne: new ObjectId(id) },
          })
          .limit(3)
          .toArray();

        res.json({ blog, relatedBlogs });
      } catch (error) {
        console.error("Error fetching blog:", error);
        res.status(500).json({ message: "Failed to fetch blog" });
      }
    });

    // Create a new blog (requires authentication)
    app.post("/blogs", verifyToken, async (req, res) => {
      try {
        const { title, content, category, excerpt } = req.body;

        // Validate required fields
        if (!title || !content || !category) {
          return res
            .status(400)
            .json({ message: "Title, content, and category are required" });
        }

        // Handle image upload and convert to base64
        let imageBuffer = null;
        if (req.files && req.files.image) {
          const image = req.files.image;
          const imageData = image.data;
          const encodedImage = imageData.toString("base64");
          imageBuffer = Buffer.from(encodedImage, "base64");
        }

        const newBlog = {
          title,
          content,
          category,
          image: imageBuffer,
          excerpt: excerpt || content.substring(0, 150) + "...",
          author: req.decoded.email,
          authorName: req.decoded.name || req.decoded.email.split("@")[0],
          createdAt: new Date(),
          updatedAt: new Date(),
          views: 0,
          likes: 0,
        };

        const result = await blogCollection.insertOne(newBlog);
        res.status(201).json({
          success: true,
          insertedId: result.insertedId,
          blog: newBlog,
        });
      } catch (error) {
        console.error("Error creating blog:", error);
        res.status(500).json({ message: "Failed to create blog" });
      }
    });

    // Update a blog (requires authentication and ownership)
    app.patch("/blogs/:id", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        const { title, content, category, excerpt } = req.body;

        // Find the blog
        const blog = await blogCollection.findOne({ _id: new ObjectId(id) });

        if (!blog) {
          return res.status(404).json({ message: "Blog not found" });
        }

        // Check if user is the author
        if (blog.author !== req.decoded.email) {
          return res
            .status(403)
            .json({ message: "You are not authorized to update this blog" });
        }

        // Handle image upload and convert to base64
        let imageUpdate = {};
        if (req.files && req.files.image) {
          const image = req.files.image;
          const imageData = image.data;
          const encodedImage = imageData.toString("base64");
          const imageBuffer = Buffer.from(encodedImage, "base64");
          imageUpdate = { image: imageBuffer };
        }

        // Update the blog
        const updatedBlog = {
          $set: {
            title: title || blog.title,
            content: content || blog.content,
            category: category || blog.category,
            excerpt:
              excerpt ||
              (content ? content.substring(0, 150) + "..." : blog.excerpt),
            updatedAt: new Date(),
            ...imageUpdate,
          },
        };

        const result = await blogCollection.updateOne(
          { _id: new ObjectId(id) },
          updatedBlog
        );

        res.json({
          success: true,
          modifiedCount: result.modifiedCount,
        });
      } catch (error) {
        console.error("Error updating blog:", error);
        res.status(500).json({ message: "Failed to update blog" });
      }
    });

    // Delete a blog (requires authentication and ownership)
    app.delete("/blogs/:id", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;

        // Find the blog
        const blog = await blogCollection.findOne({ _id: new ObjectId(id) });

        if (!blog) {
          return res.status(404).json({ message: "Blog not found" });
        }

        // Check if user is the author
        if (blog.author !== req.decoded.email) {
          return res
            .status(403)
            .json({ message: "You are not authorized to delete this blog" });
        }

        // Delete the blog
        const result = await blogCollection.deleteOne({
          _id: new ObjectId(id),
        });

        res.json({
          success: true,
          deletedCount: result.deletedCount,
        });
      } catch (error) {
        console.error("Error deleting blog:", error);
        res.status(500).json({ message: "Failed to delete blog" });
      }
    });

    // Like a blog
    app.post("/blogs/:id/like", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;

        // Check if blog exists
        const blog = await blogCollection.findOne({ _id: new ObjectId(id) });
        if (!blog) {
          return res.status(404).json({ message: "Blog not found" });
        }

        // Check if user already liked the blog
        const userEmail = req.decoded.email;
        const alreadyLiked = blog.likedBy && blog.likedBy.includes(userEmail);

        let updateOperation;
        if (alreadyLiked) {
          // Unlike: Remove user from likedBy array and decrement likes count
          updateOperation = {
            $pull: { likedBy: userEmail },
            $inc: { likes: -1 },
          };
        } else {
          // Like: Add user to likedBy array and increment likes count
          updateOperation = {
            $addToSet: { likedBy: userEmail },
            $inc: { likes: 1 },
          };
        }

        const result = await blogCollection.updateOne(
          { _id: new ObjectId(id) },
          updateOperation
        );

        res.json({
          success: true,
          liked: !alreadyLiked,
          modifiedCount: result.modifiedCount,
        });
      } catch (error) {
        console.error("Error liking/unliking blog:", error);
        res.status(500).json({ message: "Failed to process like/unlike" });
      }
    });

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
