/**
 * Seed one row of Bhagya Score content (lang=en) for CURRENT_DATE so the app has
 * something to serve on day one. Real daily rows are expected to be inserted by the
 * content pipeline; this is a safe default, marked with `seed` so `down` can remove it.
 *
 * The whole payload is embedded and written with Postgres dollar-quoting ($json$...$json$),
 * so apostrophes/quotes in the copy need no escaping.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

const ins = (percent, text) => ({ percent, text });

const PAYLOAD = {
  seed: 'fallback-v1',
  lang: 'en',
  timezone: 'Asia/Kolkata',
  rashis: [
    { key: 'mesh', name: 'Aries', date_range: '21 Mar – 19 Apr', score: 78,
      overview: "Today feels light and lucky for you. A worry that was sitting on your mind will slowly start to ease. Someone may bring good news by evening, and money matters stay steady. Just don't rush one decision — wait until you feel fully sure. Overall, the day moves in your favour.",
      closing_hook: "A change is coming your way soon — an astrologer can tell you if it brings money, love or a fresh start.",
      insights: { love: ins(82, 'Warmth flows easily today.'), career: ins(66, 'Steady progress at work.'), money: ins(38, 'Hold back on a tempting spend.'), health: ins(59, 'Good energy, but rest well.'), travel: ins(84, 'A short trip feels lucky.') } },
    { key: 'vrishabh', name: 'Taurus', date_range: '20 Apr – 20 May', score: 64,
      overview: "A calm and settled day is ahead of you. Work moves smoothly and your family stays supportive. This is a good time to plan your money slowly — what you save today will help you later. Your health stays fine if you rest well. Nothing to fear today; patience will bring what you want.",
      closing_hook: "One delay in your plans is quietly saving you from a loss — an astrologer can tell you why to wait.",
      insights: { love: ins(71, 'Trust deepens quietly.'), career: ins(58, 'Quiet effort is noticed.'), money: ins(44, 'A small saving helps later.'), health: ins(69, 'Routine suits you.'), travel: ins(35, 'Better to stay put.') } },
    { key: 'mithun', name: 'Gemini', date_range: '21 May – 20 Jun', score: 71,
      overview: "Today brings new talks, calls and small chances your way. A single conversation could open a door you did not expect. Your mind is sharp, so use it for important work. In money matters, think twice before you spend. By evening you will feel lighter and happier. A good day to connect with people.",
      closing_hook: "One message coming your way will change something important — an astrologer can tell you what to watch for.",
      insights: { love: ins(76, 'Playful energy draws people.'), career: ins(63, 'Ideas flow fast.'), money: ins(52, 'Think before you commit.'), health: ins(48, 'A restless mind needs rest.'), travel: ins(79, 'A change of scene helps.') } },
    { key: 'kark', name: 'Cancer', date_range: '21 Jun – 22 Jul', score: 55,
      overview: "Your heart feels a little heavy today, but things are not as bad as they seem. Trust your feelings, they are guiding you correctly. Your home or family may need some attention. Avoid spending on things you do not really need. Rest early and stay calm — tomorrow will feel much lighter.",
      closing_hook: "Someone close to you is hiding a worry — an astrologer can help you understand what it is.",
      insights: { love: ins(80, 'A tender moment at home.'), career: ins(47, 'Not a day to push.'), money: ins(33, 'Guard your wallet.'), health: ins(57, 'Rest and water help.'), travel: ins(62, 'A familiar place comforts.') } },
    { key: 'simha', name: 'Leo', date_range: '23 Jul – 22 Aug', score: 83,
      overview: "Today your confidence shines and people around you notice it. A chance to move ahead in work or life is very near, so step forward without fear. Luck supports your bold choices today. Money and respect both look good. Stay humble and kind, and the day will reward you well.",
      closing_hook: "A big opportunity is closer than you think — an astrologer can tell you the right time to grab it.",
      insights: { love: ins(85, 'Attraction is strong.'), career: ins(74, 'Recognition is near.'), money: ins(60, 'A fair reward may come.'), health: ins(66, 'High energy — pace it.'), travel: ins(78, 'A journey feels lucky.') } },
    { key: 'kanya', name: 'Virgo', date_range: '23 Aug – 22 Sep', score: 47,
      overview: "Today asks you to slow down and handle small things with care. Finishing one pending task will bring you real peace. Do not worry — this is a quiet day, not a bad one. Check every detail before saying yes to any money matter. Your body needs rest, not stress. Take it easy and the day passes smoothly.",
      closing_hook: "A small habit is quietly blocking your luck — an astrologer can show you how to break it.",
      insights: { love: ins(54, 'Care shows in details.'), career: ins(61, 'Your sharp eye helps.'), money: ins(36, 'Double-check a number.'), health: ins(58, 'Ease your shoulders.'), travel: ins(42, 'Plan now, travel later.') } },
    { key: 'tula', name: 'Libra', date_range: '23 Sep – 22 Oct', score: 69,
      overview: "Balance slowly returns to your life today. A decision that felt heavy will start to become clear. The right people are near to support you, so do not hesitate to ask. In money, the middle path is the safest today. Your relationships feel warmer. A fair and peaceful day is ahead — trust it.",
      closing_hook: "A choice is coming that will shape your next few months — an astrologer can tell you which way to lean.",
      insights: { love: ins(81, 'Harmony grows.'), career: ins(64, 'You are the peacemaker.'), money: ins(50, 'The middle path pays.'), health: ins(55, 'Keep balance even.'), travel: ins(73, 'A trip with company is lucky.') } },
    { key: 'vrishchik', name: 'Scorpio', date_range: '23 Oct – 21 Nov', score: 60,
      overview: "Today you can see what others around you cannot. Your gut feeling is strong and mostly correct, so trust it. Keep your plans private for now. Avoid taking money risks today; patience keeps you safe. An old matter may finally start to make sense. Move slowly and you stay one step ahead.",
      closing_hook: "There is a person whose intention toward you is not what it seems — an astrologer can reveal who.",
      insights: { love: ins(77, 'Deep connection is near.'), career: ins(59, 'You see what others miss.'), money: ins(39, 'Avoid a risky bet.'), health: ins(64, 'Release held tension.'), travel: ins(52, 'A quiet escape restores.') } },
    { key: 'dhanu', name: 'Sagittarius', date_range: '22 Nov – 21 Dec', score: 74,
      overview: "Luck leans in your favour today, so aim a little higher than usual. A trip or a new plan may bring good news your way. Your positive nature attracts the right chances. Money looks better than the last few days. Stay honest and open, and more doors keep opening. A cheerful, forward-moving day awaits.",
      closing_hook: "A new path ahead will bring a turning point — an astrologer can tell you when it truly begins.",
      insights: { love: ins(72, 'Humour wins hearts.'), career: ins(68, 'A bold idea gets a yes.'), money: ins(45, 'Do not chase gains.'), health: ins(70, 'Great day to move.'), travel: ins(88, 'Travel is strongly favoured.') } },
    { key: 'makar', name: 'Capricorn', date_range: '22 Dec – 19 Jan', score: 52,
      overview: "Today rewards your patience and hard work. A long effort is quietly moving closer to success, so do not give up now. Money grows slowly but safely — plan for the long term. Avoid overworking; one proper break will help you. Nothing bad today, just keep going steadily. Your discipline is being noticed.",
      closing_hook: "Your patience is about to pay off in a way you do not expect — an astrologer can tell you where.",
      insights: { love: ins(56, 'Reliability speaks louder.'), career: ins(71, 'Persistence is noticed.'), money: ins(49, 'Think long-term.'), health: ins(53, 'Take one real break.'), travel: ins(37, 'Postpone the long trip.') } },
    { key: 'kumbh', name: 'Aquarius', date_range: '20 Jan – 18 Feb', score: 66,
      overview: "A fresh idea comes to you today, and it is truly your own. Share it with someone who understands you and it will grow. Your different way of thinking is a real gift today. In money, study any new chance before jumping in. A light and creative day is ahead — stay open and good things will find you.",
      closing_hook: "A new opportunity is coming that looks unusual but is lucky — an astrologer can tell you if it is right for you.",
      insights: { love: ins(63, 'Connection through ideas.'), career: ins(69, 'Your angle is needed.'), money: ins(47, 'Study before you leap.'), health: ins(60, 'Ground a racing mind.'), travel: ins(75, 'An unplanned trip is lucky.') } },
    { key: 'meen', name: 'Pisces', date_range: '19 Feb – 20 Mar', score: 80,
      overview: "Today your inner feeling is very strong and points you the right way. Trust it, and let kindness lead your choices. A warm, happy moment at home or in love is likely. Your money stays steady if you keep clear limits. Rest and water will refresh you quickly. A gentle, lucky day full of good feeling is ahead.",
      closing_hook: "Your heart already knows a truth your mind is avoiding — an astrologer can help you see it clearly.",
      insights: { love: ins(86, 'Dreamy warmth surrounds you.'), career: ins(57, 'Let creativity out.'), money: ins(41, 'Keep clear limits.'), health: ins(62, 'Rest restores fast.'), travel: ins(83, 'Water soothes today.') } },
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
  pgm.sql(`DELETE FROM daily_content WHERE lang = 'en' AND payload->>'seed' = 'fallback-v1';`);
};
