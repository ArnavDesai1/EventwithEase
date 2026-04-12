import "dotenv/config";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { connectDatabase } from "../config/db.js";
import Event from "../models/Event.js";
import User from "../models/User.js";
import Review from "../models/Review.js";
import Feedback from "../models/Feedback.js";
import Booking from "../models/Booking.js";
import Ticket from "../models/Ticket.js";
import {
  demoOrganiser,
  demoAttendee,
  crowdUsers,
  demoEvents,
  bulkReviews,
  bulkFeedback,
  bookingSeeds,
  extraDemoHosts,
  eventHostEmailByTitle,
  demoCancelledEventTitle,
  demoCancelledEventAt,
} from "./demoDataset.mjs";

function ticketCode() {
  return `EWE-${uuidv4().slice(0, 8).toUpperCase()}`;
}

async function seedDemoEvents() {
  await connectDatabase();

  let organiser = await User.findOne({ email: demoOrganiser.email });
  if (!organiser) {
    const { password, ...rest } = demoOrganiser;
    const hashedPassword = await bcrypt.hash(password, 10);
    organiser = await User.create({ ...rest, password: hashedPassword, emailVerified: true });
  } else {
    organiser.hostBio = demoOrganiser.hostBio || organiser.hostBio;
    organiser.hostTagline = demoOrganiser.hostTagline || organiser.hostTagline;
    organiser.linkedinUrl = demoOrganiser.linkedinUrl || organiser.linkedinUrl;
    organiser.twitterUrl = demoOrganiser.twitterUrl || organiser.twitterUrl;
    organiser.instagramUrl = demoOrganiser.instagramUrl || organiser.instagramUrl;
    organiser.websiteUrl = demoOrganiser.websiteUrl || organiser.websiteUrl;
    if (demoOrganiser.roles?.length) organiser.roles = demoOrganiser.roles;
    organiser.emailVerified = true;
    await organiser.save();
  }

  const hostByEmail = new Map();
  hostByEmail.set(demoOrganiser.email.toLowerCase(), organiser);

  for (const hostProfile of extraDemoHosts) {
    const { password, ...hostRest } = hostProfile;
    let u = await User.findOne({ email: hostProfile.email });
    const hashedPassword = await bcrypt.hash(password, 10);
    if (!u) {
      u = await User.create({ ...hostRest, password: hashedPassword, emailVerified: true });
    } else {
      Object.assign(u, {
        name: hostProfile.name,
        role: hostProfile.role,
        roles: hostProfile.roles,
        hostBio: hostProfile.hostBio,
        hostTagline: hostProfile.hostTagline,
        linkedinUrl: hostProfile.linkedinUrl,
        twitterUrl: hostProfile.twitterUrl,
        instagramUrl: hostProfile.instagramUrl,
        websiteUrl: hostProfile.websiteUrl,
        emailVerified: true,
      });
      await u.save();
    }
    hostByEmail.set(hostProfile.email.toLowerCase(), u);
  }

  let attendee = await User.findOne({ email: demoAttendee.email });
  if (!attendee) {
    const hashedPassword = await bcrypt.hash(demoAttendee.password, 10);
    attendee = await User.create({ ...demoAttendee, password: hashedPassword, emailVerified: true });
  } else if (!attendee.emailVerified) {
    attendee.emailVerified = true;
    await attendee.save();
  }

  const crowdByEmail = new Map();
  for (const person of crowdUsers) {
    let u = await User.findOne({ email: person.email });
    const networkingOptIn = person.networkingOptIn !== undefined ? person.networkingOptIn : Boolean(person.linkedinUrl);
    if (!u) {
      const hashedPassword = await bcrypt.hash("demo1234", 10);
      u = await User.create({
        name: person.name,
        email: person.email,
        password: hashedPassword,
        emailVerified: true,
        role: "attendee",
        roles: ["attendee"],
        linkedinUrl: person.linkedinUrl || "",
        networkingOptIn,
      });
    } else {
      if (person.linkedinUrl && !u.linkedinUrl) {
        u.linkedinUrl = person.linkedinUrl;
        u.networkingOptIn = networkingOptIn;
        await u.save();
      }
    }
    crowdByEmail.set(person.email.toLowerCase(), u);
  }

  let insertedEvents = 0;
  for (const event of demoEvents) {
    const exists = await Event.exists({ title: event.title });
    if (exists) continue;

    const hostEmail = (eventHostEmailByTitle[event.title] || demoOrganiser.email).toLowerCase();
    const hostUser = hostByEmail.get(hostEmail) || organiser;

    await Event.create({ ...event, organiserId: hostUser._id });
    insertedEvents += 1;
  }

  /** Re-link organiser on every run so older DBs (seeded before host mapping) get clickable hosts. */
  let syncedDemoHosts = 0;
  for (const demo of demoEvents) {
    const hostEmail = (eventHostEmailByTitle[demo.title] || demoOrganiser.email).toLowerCase();
    const hostUser = hostByEmail.get(hostEmail) || organiser;
    const result = await Event.updateOne({ title: demo.title }, { $set: { organiserId: hostUser._id } });
    if (result.modifiedCount) syncedDemoHosts += 1;
  }

  await Event.updateOne(
    { title: demoCancelledEventTitle },
    { $set: { cancelledAt: new Date(demoCancelledEventAt) } }
  );

  let insertedReviews = 0;
  for (const [title, rating, comment, email] of bulkReviews) {
    const event = await Event.findOne({ title });
    const reviewer = crowdByEmail.get(email.toLowerCase()) || (await User.findOne({ email: email.toLowerCase() }));
    if (!event || !reviewer) continue;

    const dup = await Review.findOne({ eventId: event._id, attendeeId: reviewer._id });
    if (dup) continue;

    await Review.create({
      eventId: event._id,
      attendeeId: reviewer._id,
      rating,
      comment,
      createdAt: new Date(Date.now() - Math.floor(Math.random() * 45) * 86400000),
    });
    insertedReviews += 1;
  }

  let insertedFeedback = 0;
  for (const [title, rating, feedback, email] of bulkFeedback) {
    const event = await Event.findOne({ title });
    const author = crowdByEmail.get(email.toLowerCase()) || (await User.findOne({ email: email.toLowerCase() }));
    if (!event || !author) continue;

    const dup = await Feedback.findOne({ eventId: event._id, attendeeId: author._id });
    if (dup) continue;

    await Feedback.create({
      eventId: event._id,
      attendeeId: author._id,
      rating,
      feedback,
    });
    insertedFeedback += 1;
  }

  let insertedBookings = 0;
  for (const [title, email, typeName, quantity, checkedIn] of bookingSeeds) {
    const event = await Event.findOne({ title });
    const user = crowdByEmail.get(email.toLowerCase()) || (await User.findOne({ email: email.toLowerCase() }));
    if (!event || !user) continue;

    const ticketType = event.ticketTypes.find((t) => t.name === typeName);
    if (!ticketType) {
      console.warn(`[seed] Skip booking: no ticket type "${typeName}" on "${title}"`);
      continue;
    }

    const hasBooking = await Booking.exists({ eventId: event._id, attendeeId: user._id });
    if (hasBooking) continue;

    const price = Number(ticketType.price) || 0;
    const qty = Number(quantity) || 1;
    const subtotal = price * qty;

    const booking = await Booking.create({
      eventId: event._id,
      attendeeId: user._id,
      subtotalAmount: subtotal,
      discountAmount: 0,
      discountCode: "",
      totalAmount: subtotal,
      quantity: qty,
    });

    const ticketDocs = Array.from({ length: qty }, () => ({
      ticketCode: ticketCode(),
      eventId: event._id,
      bookingId: booking._id,
      userId: user._id,
      ticketTypeName: typeName,
      price,
      status: checkedIn ? "checked-in" : "booked",
      checkedInAt: checkedIn ? new Date(Date.now() - 86400000 * Math.floor(Math.random() * 14)) : null,
    }));

    await Ticket.insertMany(ticketDocs);
    insertedBookings += 1;
  }

  console.log("— EventwithEase demo seed —");
  console.log(`Events inserted (new titles only): ${insertedEvents}`);
  console.log(`Demo events host re-linked (updated rows): ${syncedDemoHosts}`);
  console.log(`Reviews inserted: ${insertedReviews}`);
  console.log(`Feedback inserted: ${insertedFeedback}`);
  console.log(`Bookings + tickets inserted: ${insertedBookings}`);
  console.log(`Organiser login: ${demoOrganiser.email} / ${demoOrganiser.password}`);
  console.log(`Attendee login: ${demoAttendee.email} / ${demoAttendee.password}`);
  console.log(`Crowd users (reviews/bookings): password demo1234 for all crowd.*@eventwithease.com`);
}

seedDemoEvents()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });
