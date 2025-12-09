import 'dotenv/config';
import { MongoClient } from 'mongodb';

async function testQueryAllSessions() {
  console.log("Running test...");

  const mongoUrl = process.env.DB_CONNECTION_STRING; // from your .env
  if (!mongoUrl) throw new Error("MONGO_URL not set in .env");

  const client = new MongoClient(mongoUrl);
  await client.connect();

  const db = client.db(); // will use the DB from the URL, or default if not specified
  const sessions = db.collection('sessions');

  const query = {
    lastSeenAt: {
      $gte: new Date('1970-01-01T00:00:00.000Z'),
      $lte: new Date('3000-01-01T00:00:00.000Z')
    }
  };

  const allSessions = await sessions.find(query).toArray();
  console.log('All sessions:', allSessions);

  await client.close();
}

console.log("Heyy");
testQueryAllSessions();
