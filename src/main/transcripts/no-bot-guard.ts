// MEET-06: Aria only accepts user-supplied transcript text. It must not join
// live meetings as a bot, call recording services, or store cloud recordings.
export const MEETING_BOT_BLOCKLIST = [
  'recall.ai',
  '@recallai',
  'symbl.ai',
  '@symbl',
  'fireflies.ai/api',
  'otter.ai/api',
  'tldv.io/api',
  'zoom.us/rec',
  'meetingbot',
  'recording-bot',
] as const;
