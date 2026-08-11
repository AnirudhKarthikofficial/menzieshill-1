// Events on calendar management.
import {
  NextFunction, Request, Response, Router
} from "express";
import { isEmpty, isISO8601, trim } from "validator";
import isLength from "validator/lib/isLength";

import Database from "../db";
import { Cancellation } from "../db/entity/Cancellation.entity";
import {
  CalendarEvent, EventColour, EventType, Repeat
} from "../db/entity/Event.entity";
import auth from "../middleware/auth";
import {
  cleanString, errorCatch, errorGenerator, Perms, validId, validName
} from "../util";

const events = Router();

// Note - I did some testing. 100 Events is about 25kb, and we won't even have nearly that many.
// Get all events around current date.

events.get("/", errorCatch(async (req: Request, res: Response) => {
  // Defaults
  let min: Date = new Date();
  let max: Date = new Date();

  // FIX: Cast req.query.min as string to resolve TS2345
  if (req.query.min && !isEmpty(req.query.min as string)) {
    try {
      const str = decodeURIComponent(req.query.min as string);
      if (isISO8601(str)) {
        min = new Date(str);
      } else {
        return res.status(400).send(errorGenerator(400, "Invalid min date."));
      }
    } catch (e) {
      return res.status(400).send(errorGenerator(400, "Invalid URI component"));
    }
  } else {
    min = new Date();
    min.setUTCMonth(new Date().getMonth() - 1);
    min.setUTCDate(1);
    min.setUTCHours(0);
    min.setUTCMinutes(0);
  }

  // FIX: Cast req.query.max as string to resolve TS2345
  if (req.query.max && !isEmpty(req.query.max as string)) {
    try {
      const str = decodeURIComponent(req.query.max as string);
      if (isISO8601(str)) {
        max = new Date(str);
      } else {
        return res.status(400).send(errorGenerator(400, "Invalid max date."));
      }
    } catch (e) {
      return res.status(400).send(errorGenerator(400, "Invalid URI component"));
    }
  } else {
    // Start of 2 months after
    max.setUTCMonth(new Date().getMonth() + 2);
    max.setUTCDate(1);
    max.setUTCHours(0);
    max.setUTCMinutes(0);
  }
  const normalEvents = await Database.getEvents(min, max);

  // Min, max are only used for cancellations.
  const recurringEvents = await Database.getRecurringEvents(min, max);
  res.send({
    recurring: recurringEvents,
    events: normalEvents,
    success: true
  });
  return undefined;
}));

events.use(auth([Perms.manageEvents]));
// Create new event
events.post("/", errorCatch(async (req: Request, res: Response) => {
  const startEvent = new CalendarEvent();
  const newEvent = modifyEvent(startEvent, req.body);
  if (!newEvent.name) {
    res.status(400).send(errorGenerator(400, "Invalid or missing event name."));
  } else if (!newEvent.when) {
    res.status(400).send(errorGenerator(400, "Invalid or missing event date."));
  } else {
    // It's ok
    await Database.modifyEvent(newEvent);
    res.send({
      success: true,
      message: `Successfully created Event ${newEvent.name}!`,
      event: newEvent
    });
  }
}));

// ALl these APIs depend on /:eventId
events.all("/:eventId*", errorCatch(async (req: Request, res: Response, next: NextFunction) => {
  if (validId(req.params.eventId)) {
    const event = await Database.getEvent(parseInt(req.params.eventId, 10));
    if (event) {
      req.event = event;
      return next();
    }
    res.status(404).send(errorGenerator(404, "Event not found."));
  } else {
    res.status(400).send(errorGenerator(400, "Invalid event id: Please provide a number."));
  }
  return undefined;
}));
// Get existing event - used for the admin panel only
events.get("/:eventId", errorCatch(async (req: Request, res: Response) => {
  if (req.event) {
    const { event } = req;
    res.send({
      message: `Event found`,
      success: true,
      event
    });
  } else {
    res.status(404).send(errorGenerator(404, "Failed to get event: Event not found."));
  }
}));

// Modify existing event
events.patch("/:eventId", errorCatch(async (req: Request, res: Response) => {
  if (req.event) {
    const { event } = req;
    const newEvent = modifyEvent(event, req.body);
    await Database.modifyEvent(newEvent);
    res.send({
      message: `Successfully edited event ${newEvent.name}!`,
      success: true,
      event: newEvent
    });
  } else {
    res.status(404).send(errorGenerator(404, "Failed to edit event: Event not found."));
  }
}));

function modifyEvent (event: CalendarEvent, body: any): CalendarEvent {
  const newEvent = { ...event };
  if (validName(body.name)) {
    newEvent.name = trim(body.name);
  }

  if (body.description && typeof body.description === "string" && isLength(body.description, {
    min: 0,
    max: 100000
  })) {
    newEvent.description = cleanString(body.description);
  }

  // Date
  if (body.when && !isEmpty(body.when) && isISO8601(body.when)) {
    // Check it's a reasonably time
    const d = new Date(body.when);
    if (d.getTime() - Date.now() > 0 || d.getTime() - Date.now() < 473364000000) {
      newEvent.when = new Date(body.when);
    }
  }
  if (body.length !== undefined && isNaN(body.length)) {
    const length = parseInt(body.length, 10);
    if (length > 24 || length <= 0) {
      newEvent.length = 2; // we ignore the given, invalid values.
    }
  } else {
    newEvent.length = 2;
  }

  // Colour
  const typedColour = body.colour as keyof typeof EventColour;
  if (typedColour && EventColour[typedColour]) {
    newEvent.colour = EventColour[typedColour];
  }

  const typedType = body.type as keyof typeof EventType;
  if (typedType && EventType[typedType]) {
    newEvent.type = EventType[typedType];
  }

  const typedRepeat = body.repeat as keyof typeof Repeat;
  if (typedRepeat && Repeat[typedRepeat]) {
    newEvent.repeat = Repeat[typedRepeat];
  }
  return newEvent;
}

// Delete existing event
events.delete("/:eventId", errorCatch(async (req: Request, res: Response) => {
  if (req.event) {
    const { event } = req;
    await Database.deleteEvent(event);
    res.send({
      success: true,
      message: `Successfully deleted event ${event.name}.`
    });
  } else {
    res.status(404).send(errorGenerator(404, "Event not found."));
  }
}));

// Cancellations

// Add cancellation
events.post("/:eventId/cancel", errorCatch(async (req: Request, res: Response) => {
  // Validation
  if (req.event && req.user) {
    // Event exists: Validate cancellation params.
    const cancellation = modifyCancellation(new Cancellation(), req.body, req.event);
    if (!cancellation.when && req.event.repeat !== Repeat.None) {
      return res.status(400).send(errorGenerator(400, "Missing or invalid 'when' value for repeating event."));
    }
    // Valid
    // check for already existing
    cancellation.event = req.event;

    const existing = await Database.checkCancellation(cancellation);
    if (existing.length !== 0) {
      return res.status(400).send(errorGenerator(400, "Cancellation already exists."));
    }

    const {
      id, username, firstName, lastName
    } = req.user;
    cancellation.cancelledBy = {
      id,
      username,
      firstName,
      lastName
    };
    // It's new so this is OK

    await Database.modifyCancellation(cancellation);
    return res.send({
      success: true,
      cancellation,
      message: `Successfully added cancellation for event ${req.event.name}`
    });
  }
  return undefined;
}));

// Edit cancellation
events.patch("/:eventId/cancel/:cancelId", errorCatch(async (req: Request, res: Response) => {
  // These two WILL be defined. They're checked to please typescript.
  if (req.event && req.user && validId(req.params.cancelId)) {
    // Event exists: Validate cancellation params.
    const initialCancellation = await Database.getCancellation(parseInt(req.params.cancelId, 10));
    if (!initialCancellation) {
      return res.status(404).send(errorGenerator(404, "Cancellation not found."));
    }

    const cancellation = modifyCancellation(initialCancellation, req.body, req.event);
    const {
      id, username, firstName, lastName
    } = req.user;
    cancellation.cancelledBy = {
      id,
      username,
      firstName,
      lastName
    };
    cancellation.event = req.event;

    await Database.modifyCancellation(cancellation);
    const send = {
      success: true,
      cancellation,
      message: `Successfully added cancellation for event ${req.event.name}`
    };

    return res.send(send);
  }
  return res.status(400).send(errorGenerator(400, "Invalid cancellation id."));
}));

function modifyCancellation (cancellation: Cancellation, body: any, event: CalendarEvent) {
  const newCancellation = { ...cancellation };
  if (body.reason && typeof body.reason === "string") {
    newCancellation.reason = cleanString(body.reason);
  }
  // Only required if event is a repeatable.
  if (body.when && event.repeat !== Repeat.None) {
    if (!isEmpty(body.when) && isISO8601(body.when)) {
      const parsed = new Date(body.when);
      if (parsed.getTime() >= event.when.getTime()) {
        // It's valid (enough)
        newCancellation.when = parsed;
      }
    }
  } else {
    newCancellation.when = event.when;
  }
  return newCancellation;
}

// Delete cancellation
events.delete("/:eventId/cancel/:cancelId", errorCatch(async (req: Request, res: Response) => {
  if (req.event && validId(req.params.cancelId)) {
    const cancellation = await Database.getCancellation(parseInt(req.params.cancelId, 10));
    if (cancellation) {
      await Database.deleteCancellation(cancellation);
      res.send({
        success: true,
        message: "Deleted cancellation."
      });
    } else {
      res.status(404).send(errorGenerator(404, "Cancellation not found."));
    }
  } else {
    res.status(400).send(errorGenerator(400, "Invalid cancellation id."));
  }
}));

export default events;
