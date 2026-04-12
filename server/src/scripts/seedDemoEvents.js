import "dotenv/config";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { connectDatabase } from "../config/db.js";
import Event from "../models/Event.js";
import User from "../models/User.js";

const demoOrganiser = {
  name: "Demo Organiser",
  email: "demo.organiser@eventwithease.com",
  password: "demo1234",
  role: "organiser",
};


const demoAttendee = {
  name: "Demo Attendee",
  email: "demo.attendee@eventwithease.com",
  password: "demo1234",
  role: "attendee",
};
const demoEvents = [
  {
    title: "Hack Night 2026",
    description:
      "A late-night build sprint for students, founders, and makers with live mentors, mini challenges, and a final demo showcase.",
    location: "Bangalore International Centre, Bengaluru",
    venueType: "physical",
    category: "Tech",
    date: "2026-05-01T18:30:00.000Z",
    coverImage:
      "https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&w=1200&q=80",
    agenda: ["18:30 - Doors open", "19:00 - Kickoff keynote", "20:30 - Demo showcase"],
    speakers: ["Demo Organiser", "Guest Mentor"],
    faq: [{ question: "Is food included?", answer: "Light snacks and coffee are provided." }],
    venueMapUrl: "https://maps.google.com/?q=Bangalore+International+Centre",
    discountCodes: [
      { code: "HACK10", type: "percent", value: 10, expiresAt: "2026-04-30" },
    ],
    ticketTypes: [
      { name: "General", price: 499, earlyBirdPrice: 399, earlyBirdEndsAt: "2026-04-25", quantity: 80 },
      { name: "VIP", price: 999, earlyBirdPrice: 799, earlyBirdEndsAt: "2026-04-25", quantity: 25 },
    ],
  },
  {
    title: "City Beats Live",
    description:
      "An open-air indie music evening with food stalls, creator booths, and a high-energy headline set under the city lights.",
    location: "Jio World Garden, Mumbai",
    venueType: "physical",
    category: "Music",
    date: "2026-05-10T19:00:00.000Z",
    coverImage:
      "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=1200&q=80",
    agenda: ["19:00 - Gates open", "20:00 - Headline set", "22:00 - Closing"],
    speakers: ["City Beats Ensemble"],
    faq: [{ question: "Are outside cameras allowed?", answer: "Yes, handheld cameras are allowed." }],
    venueMapUrl: "https://maps.google.com/?q=Jio+World+Garden",
    discountCodes: [
      { code: "CITY200", type: "amount", value: 200, expiresAt: "2026-05-05" },
    ],
    ticketTypes: [
      { name: "Early Bird", price: 699, earlyBirdPrice: 599, earlyBirdEndsAt: "2026-05-01", quantity: 120 },
      { name: "Lounge", price: 1499, earlyBirdPrice: 1199, earlyBirdEndsAt: "2026-05-01", quantity: 40 },
    ],
  },
  {
    title: "Founder Sprint Summit",
    description:
      "A focused business summit covering pitch practice, fundraising basics, growth experiments, and founder networking.",
    location: "T-Hub, Hyderabad",
    venueType: "physical",
    category: "Business",
    date: "2026-05-18T10:00:00.000Z",
    coverImage:
      "https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=1200&q=80",
    ticketTypes: [
      { name: "Delegate", price: 1299, quantity: 90 },
      { name: "Founder Circle", price: 2499, quantity: 25 },
    ],
  },
  {
    title: "Design Jam Workshop",
    description:
      "A hands-on workshop where participants design a landing page, test it with users, and leave with a polished case-study draft.",
    location: "The Hive, Pune",
    venueType: "physical",
    category: "Workshop",
    date: "2026-05-24T14:00:00.000Z",
    coverImage:
      "https://images.unsplash.com/photo-1542744173-8e7e53415bb0?auto=format&fit=crop&w=1200&q=80",
    ticketTypes: [
      { name: "Workshop Pass", price: 899, quantity: 60 },
      { name: "Mentor Session", price: 1599, quantity: 15 },
    ],
  },
];

async function seedDemoEvents() {
  await connectDatabase();

  let organiser = await User.findOne({ email: demoOrganiser.email });
  if (!organiser) {
    const hashedPassword = await bcrypt.hash(demoOrganiser.password, 10);
    organiser = await User.create({ ...demoOrganiser, password: hashedPassword, emailVerified: true });
  }

  let attendee = await User.findOne({ email: demoAttendee.email });
  if (!attendee) {
    const hashedPassword = await bcrypt.hash(demoAttendee.password, 10);
    attendee = await User.create({ ...demoAttendee, password: hashedPassword, emailVerified: true });
  } else if (!attendee.emailVerified) {
    attendee.emailVerified = true;
    await attendee.save();
  }

  let inserted = 0;
  for (const event of demoEvents) {
    const exists = await Event.exists({ title: event.title });
    if (exists) continue;

    await Event.create({ ...event, organiserId: organiser._id });
    inserted += 1;
  }

  console.log(`Demo seed complete. Inserted ${inserted} event(s).`);
  console.log(`Demo organiser login: ${demoOrganiser.email} / ${demoOrganiser.password}`);
  console.log(`Demo attendee login: ${demoAttendee.email} / ${demoAttendee.password}`);
}

seedDemoEvents()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });
