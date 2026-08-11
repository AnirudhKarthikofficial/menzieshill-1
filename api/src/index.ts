/*
  Copyright © Josh Muir 2020.
  Produced for Menzieshill Whitehall Swimming and Water Polo club, a registered charity.
  The unauthorised distribution of this software or any derivative works is strictly prohibited.
 */

// Main API server entry point.

// Deps
import * as sentry from "@sentry/node";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import "reflect-metadata";
import cors from "cors";
// FIX: Imported Request, Response, and NextFunction explicitly
import express, { Request, Response, NextFunction } from "express";
import helmet from "helmet";

import { port, sentryDsn } from "../config";
import db from "./db";
import { csrfMiddleware } from "./middleware/csrf";
// Routes
import contact from "./routes/contact";
import events from "./routes/events";
import files from "./routes/files";
import groups from "./routes/groups";
import posts from "./routes/posts";
import users from "./routes/users";
import { errorGenerator, errorHandler } from "./util";

// Set up
const app = express();
sentry.init({ dsn: sentryDsn });
// TODO: Set CORS
app.use(cors({ //
  origin: ["http://localhost:1234", "https://menzieshillwhitehall.co.uk", "http://menzieshillwhitehall.co.uk", "https://api.menzieshillwhitehall.co.uk", "https://menzieshillwhitehall.co.uk"],
  credentials: true
}));
app.use(helmet());
app.options("*", cors());

// Global middleware
app.use(sentry.Handlers.requestHandler());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(csrfMiddleware);

// Routes
app.use("/files", files);
app.use("/users", users);
app.use("/posts", posts);
app.use("/events", events);
app.use("/contact", contact);

app.use("/groups", groups);

// FIX: Added typings to the root route
app.get("/", (_req: Request, res: Response) => res.send({
  message: "API root. No docs are available.",
  status: 200
}));

// Error handling
app.use(sentry.Handlers.errorHandler());
app.use(errorHandler);

// 404
// FIX: Added explicit typings here to prevent TS2769 (No overload matches this call)
app.use((_req: Request, res: Response, _next: NextFunction) => {
  res.status(404).send(errorGenerator(404, "Resource not found."));
});

process.on("uncaughtException", err => {
  console.error("There was an uncaught error", err);
  process.exit(1); // mandatory (as per the Node.js docs)
});

db.once("ready", () => {
  app.listen(port, () => console.log(`Menzieshill API starting on ${port}.`));
});
