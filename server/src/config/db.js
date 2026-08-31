import mongoose from 'mongoose';

export async function connectDB(uri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  console.log(`MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`);

  mongoose.connection.on('error', (err) => console.error('MongoDB error:', err.message));
  mongoose.connection.on('disconnected', () => console.warn('MongoDB disconnected'));
}
