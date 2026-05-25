import 'dotenv/config';
import mongoose from 'mongoose';
import User from './src/models/User.js';
import Group from './src/models/Group.js';
import Program from './src/models/Program.js';

const uri = process.env.MONGO_URL;
if (!uri) {
  console.error('MONGO_URL not set');
  process.exit(1);
}

try {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  const total = await User.countDocuments({ role: 'student' });
  const noGroup = await User.countDocuments({ role: 'student', groupId: null });
  const withGroup = await User.countDocuments({ role: 'student', groupId: { $ne: null } });
  const sampleMissing = await User.find({ role:'student', groupId: null }).limit(10).select('username email fullName studyForm subgroup');
  const sampleWith = await User.find({ role:'student', groupId: { $ne: null } }).limit(10).populate({ path:'groupId', select:'name programId' }).select('username fullName groupId');
  const groups = await Group.find().select('name programId');
  const groupCounts = await User.aggregate([
    { $match: { role: 'student', groupId: { $ne: null } } },
    { $group: { _id: '$groupId', count: { $sum: 1 } } },
  ]);
  const programs = await mongoose.model('Program').find().select('name code facultyId');
  console.log(JSON.stringify({ total, noGroup, withGroup }, null, 2));
  console.log('programs', JSON.stringify(programs, null, 2));
  console.log('groupCounts', JSON.stringify(groupCounts, null, 2));
  console.log('groups', JSON.stringify(groups, null, 2));
  console.log('missing sample', JSON.stringify(sampleMissing, null, 2));
  console.log('with sample', JSON.stringify(sampleWith.map(s => ({username:s.username, fullName:s.fullName, groupName:s.groupId?.name})), null, 2));
} catch (err) {
  console.error(err);
  process.exit(1);
} finally {
  await mongoose.disconnect();
}
