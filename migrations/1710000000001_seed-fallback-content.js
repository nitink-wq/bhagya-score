/**
 * Seed one row of Bhagya Score content (lang=en) for CURRENT_DATE so the app has
 * something to serve on day one. Real daily rows are inserted by the Gemini pipeline;
 * this is a safe default, marked with `seed` so `down` can remove it.
 *
 * Schema per sign (the shape the page consumes):
 *   { sign, score(42-94), band(<=60), reason(<=60, one planet), insight(<=280),
 *     signs[3] (each <=95, one specific thing, stops before the answer), lucky:{num,time,cols[3]} }
 *
 * The whole payload is embedded and written with Postgres dollar-quoting ($json$...$json$),
 * so apostrophes/quotes in the copy need no escaping.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

const PAYLOAD = {
  seed: 'fallback-v4',
  lang: 'en',
  timezone: 'Asia/Kolkata',
  rashis: [
    { sign: 'aries', score: 72,
      band: 'An old problem finally starts to clear',
      reason: 'Mars is working with you, not against you',
      insight: 'The stars favour finishing old work today, not starting new. A problem that has followed you for days will loosen by evening. Money choices are better paused this week, because Mercury is moving slow. Keep the evening for family, one talk there will settle your mind.',
      signs: ['One problem that kept returning is ready to close, sooner than you expect.', 'A money step this week has a wrong time and a right time.', 'Someone at home is waiting for more of your evening.'],
      lucky: { num: 9, time: '7:15 AM', cols: ['#F1662B', '#F5B71D', '#2E9E5B'] } },
    { sign: 'taurus', score: 61,
      band: 'A slow day that protects you',
      reason: 'Venus asks you to review, not rush',
      insight: 'Today is built for going over things, not starting them. An old task you know well will go smoother than anything new. Watch your spending today, a careful look will show you one leak. A call from someone far away can lift your whole day.',
      signs: ['A person far from you is about to reach out with something good.', 'One regular expense is quietly taking more than it should.', 'A new plan can wait, and waiting will actually help it.'],
      lucky: { num: 6, time: '6:40 PM', cols: ['#2E9E5B', '#8FD3B6', '#F5B71D'] } },
    { sign: 'gemini', score: 56,
      band: 'A day to fix, not to start',
      reason: 'Mercury, your planet, is moving slow this week',
      insight: 'Mercury rules your sign, and it is moving slow till the 24th. So old plans need a second look before they move ahead. One small decision today quietly pushes a big goal forward. An old friend or contact is worth reconnecting with now. Do not force results, let them come.',
      signs: ['One small choice today is connected to a much bigger goal.', 'An old contact is thinking about you more than you know.', 'A plan you are pushing hard needs one correction first.'],
      lucky: { num: 5, time: '11:20 AM', cols: ['#F5A524', '#7EC8E3', '#F1662B'] } },
    { sign: 'cancer', score: 84,
      band: 'Your work is getting noticed today',
      reason: 'Jupiter is sitting strong in your sign',
      insight: 'Jupiter is strong in your sign right now, and it shows. Senior people are watching your work with a good eye today. An unfinished plan from before deserves a fresh look, it can move now. Keep office worries at the office, home will feel light tonight.',
      signs: ['A senior person has already noticed you, the result comes soon.', 'One old plan you dropped is worth picking up this week.', 'A good change at work is closer than it appears.'],
      lucky: { num: 2, time: '9:00 PM', cols: ['#C9D6FF', '#F5B71D', '#E5A0C8'] } },
    { sign: 'leo', score: 68,
      band: 'New learning opens a door today',
      reason: 'The Sun pushes you to grow today',
      insight: 'Today pulls you out of routine, and that is a good thing. A teacher or senior will say one line that stays with you. Papers and forms need a second read this week, so go slow there. A short trip or a new course is better than it first looks.',
      signs: ['One piece of advice today is worth more than it sounds.', 'A paper or form is hiding one detail you should read twice.', 'A chance to learn something new has good timing right now.'],
      lucky: { num: 1, time: '12:30 PM', cols: ['#F1662B', '#F5B71D', '#E5484D'] } },
    { sign: 'virgo', score: 88,
      band: 'One of your best days this month',
      reason: 'The Moon is sitting in your sign today',
      insight: 'The Moon spends today in your sign, a strong sign of luck. Money matters you kept postponing will open easily now. A difficult talk becomes clear if you have it today. Trust your own judgement, it is sharper than usual. Let one old worry go tonight.',
      signs: ['A money matter you postponed is finally ready to move.', 'One difficult talk will go your way if it happens today.', 'Your judgement is stronger today, one choice will prove it.'],
      lucky: { num: 5, time: '8:10 AM', cols: ['#8FD3B6', '#F0D9A8', '#B8A99D'] } },
    { sign: 'libra', score: 63,
      band: 'A quiet day that clears your head',
      reason: 'Venus turns your mind toward balance',
      insight: 'The day favours quiet over noise for you. Answers you were chasing will come when you sit still. One plan grows stronger if you simply review it today. Hold your wallet close, an impulse buy will tempt you by evening.',
      signs: ['The answer you are looking for arrives in a quiet moment.', 'One plan needs review, not speed, and it will reward you.', 'An evening temptation to spend is not worth it this time.'],
      lucky: { num: 6, time: '5:45 PM', cols: ['#E5A0C8', '#C9D6FF', '#F5B71D'] } },
    { sign: 'scorpio', score: 76,
      band: 'One conversation changes your day',
      reason: 'Mars connects you to the right people',
      insight: 'An unexpected talk today carries a real direction for you. The right person is closer than you think, so share your idea. Work you build with others moves twice as fast now. Keep your focus on what already exists, not on new starts.',
      signs: ['A person you did not plan to meet has something you need.', 'Your idea grows the moment you say it out loud to the right one.', 'Help you did not ask for is on its way to you.'],
      lucky: { num: 9, time: '10:15 PM', cols: ['#8A2846', '#E5484D', '#F5B71D'] } },
    { sign: 'sagittarius', score: 58,
      band: 'Quiet effort today, reward later',
      reason: 'Jupiter asks for patience from you today',
      insight: 'Today tests how steady you are, not how fast. Your work is being counted, even if nobody says it yet. The praise you deserve is coming, just not today. One trusted friend can show you what you are missing.',
      signs: ['Someone is keeping track of your effort without telling you.', 'A reward for old work is delayed, not cancelled.', 'One friend sees your situation clearer than you do right now.'],
      lucky: { num: 3, time: '4:20 PM', cols: ['#F1662B', '#7EC8E3', '#F5B71D'] } },
    { sign: 'capricorn', score: 79,
      band: 'A strong day for your next step',
      reason: 'Saturn steadies every step you take today',
      insight: 'The stars back careful planning today. Collect full information before you sign or send anything this week. Someone close will drop advice that turns out unexpectedly useful. One firm step today makes your position stronger for the month.',
      signs: ['Advice from someone near you is worth more than it sounds.', 'One paper or payment needs full checking before it moves.', 'A single step this week can secure your whole month.'],
      lucky: { num: 8, time: '7:50 AM', cols: ['#5A4A40', '#B8A99D', '#2E9E5B'] } },
    { sign: 'aquarius', score: 50,
      band: 'A careful day, choose words slowly',
      reason: 'Saturn is testing your patience today',
      insight: 'Today asks for soft words and open talk. A misunderstanding near you clears the moment you speak honestly. Money that is shared, in family or work, needs a clear conversation. Go slow, your patience today quietly becomes your strength.',
      signs: ['One misunderstanding is waiting for a single honest sentence.', 'A shared money matter needs daylight before it grows.', 'Words said in a hurry today can cost more than they seem.'],
      lucky: { num: 11, time: '9:30 AM', cols: ['#7EC8E3', '#C9D6FF', '#F5B71D'] } },
    { sign: 'pisces', score: 71,
      band: 'Small moments carry big warmth today',
      reason: 'The Moon turns your eyes to people you love',
      insight: 'The day belongs to your people, not your tasks. One honest talk will bring someone closer than before. Work moves slowly, and that is normal today, do not read it wrong. Keep the evening for something creative or someone dear.',
      signs: ['One honest sentence can repair more than you expect.', 'A slow day at work is not a sign of trouble, it only looks like one.', 'Your evening holds a warm moment if you keep it free.'],
      lucky: { num: 7, time: '6:15 AM', cols: ['#7EC8E3', '#8FD3B6', '#E5A0C8'] } },
  ],
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(
    `INSERT INTO daily_content (date, lang, payload)
     VALUES (CURRENT_DATE, 'en', $json$${JSON.stringify(PAYLOAD)}$json$::jsonb)
     ON CONFLICT (date, lang) DO NOTHING;`,
  );
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DELETE FROM daily_content WHERE lang = 'en' AND payload->>'seed' IN ('fallback-v1', 'fallback-v2', 'fallback-v3', 'fallback-v4');`);
};
