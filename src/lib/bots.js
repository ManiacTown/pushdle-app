// Fixed roster — these never change once picked, so the same "player" shows
// up on the leaderboard every day (only their score changes). Append new
// names to the end if the roster ever needs to grow; don't reorder or
// rename existing ones, since that would look like an account renaming
// itself to a real visitor.
export const BOT_USERNAMES = [
  'NightOwl42', 'QuantumLeap', 'ZeroGravity', 'PixelPusher', 'SilentStorm',
  'LuckyCharm7', 'MidnightRunner', 'ByteMeNot', 'CosmicDrift', 'ThinIce',
  'NoScopeNancy', 'GlitchGremlin', 'VelvetThunder', 'RustyCircuit', 'FeatherFall',
  'EchoChamber', 'SaltyDog99', 'PaperTiger', 'DizzySpell', 'BlueCollarBot',
  // Second batch — procedurally generated (adjective+noun+number, weighted
  // toward including a number) rather than hand-picked, same
  // never-reorder/never-rename rule applies.
  'CosmicWolf9208', 'GrumpyFerret', 'IronBadger365', 'FrostyWizard87', 'RogueNomad88',
  'IcyPenguin', 'NeonOtter791', 'PhantomMoose', 'Sparrow_2815', 'WildTiger811',
  'Raven_5685', 'QuietWolf', 'SunnyComet451', 'StormyBadger12', 'ChillViper20',
  'Sparrow_6744', 'PhantomKoala79', 'Viper_4518', 'PhantomGecko661', 'Ninja_8632',
  'StormyOtter32', 'NeonStorm138', 'WildPenguin76', 'QuietSparrow86', 'PhantomYeti920',
  'RustyNomad86', 'Mantis_2627', 'SilentDragon96', 'CheekyMoose315', 'Lynx_5575',
];

// Real auth.users/profiles rows exist for every name above (see
// scripts/seed-bots.mjs for the initial lifetime-stat seeding, and
// scripts/simulate-bot-day.mjs for the once-a-day real run each bot gets
// added on top of that) — capped so none of them ever earn a
// *special*-rarity badge, with a real flair emoji only where their stats
// actually earned it. This map is what makes a bot's leaderboard row
// clickable (see Leaderboard.jsx) and lets PublicProfile.jsx look them up
// like any real player — bots are otherwise indistinguishable from real
// accounts at read time; both today's streak (daily_runs) and lifetime
// stats (profiles) are genuine rows now, not derived/simulated client-side.
export const BOT_USER_IDS = {
  NightOwl42: 'ec3badab-f92a-4346-940e-d4c914f85047',
  QuantumLeap: '7878b8f7-421a-459a-908f-ec5e050bb53e',
  ZeroGravity: '4910b981-ce49-419c-ae95-eda62c579cf3',
  PixelPusher: '7994f637-20ad-4d49-980c-ad40724417b6',
  SilentStorm: '6c122b71-1bc9-4e25-a9d0-9d3104007233',
  LuckyCharm7: 'd992e052-b3d6-4c53-8b12-6528b4ef6a89',
  MidnightRunner: '22030195-778e-403c-a63c-9eda27abcc27',
  ByteMeNot: '838269a7-395c-4263-83f9-d5401f693c08',
  CosmicDrift: '9f9bf0b1-e404-4229-af1c-5841af327739',
  ThinIce: '0e049895-a8b5-479d-a33a-d84549c3c804',
  NoScopeNancy: '175701a3-9c8b-47d0-8cfe-690ad299369c',
  GlitchGremlin: '41493500-274e-4e7f-b5d1-00da4e5194c8',
  VelvetThunder: '26edf17a-aa8c-4272-8679-b3c6b99d66e0',
  RustyCircuit: '9c77da4a-7f9d-407a-b202-92d4a841068f',
  FeatherFall: '2474ff53-70a0-4e21-9f38-5181f97e75f5',
  EchoChamber: 'e2b1b06b-9602-413b-9d34-b33c3a8ae0c0',
  SaltyDog99: '10002f14-12b6-4022-8cbf-1f2681b7b1d5',
  PaperTiger: 'f693bd43-26ef-4042-a80b-9ffc9425660e',
  DizzySpell: 'd6d05a77-fe0b-4fd4-96f1-ccfb88d5ed98',
  BlueCollarBot: '6bdbcb09-beaf-4318-bd49-5f6d51d4d70b',
  CosmicWolf9208: 'fbda6e31-b429-4a9b-959a-abd94025e7ef',
  GrumpyFerret: '2c3a3bba-936f-4b2c-bf63-07b31c4b3b74',
  IronBadger365: '63db39e1-05a2-4f24-90ff-2ef30f3f021e',
  FrostyWizard87: '50e46987-8792-4e58-afdb-5e1a8df0630a',
  RogueNomad88: '969f7b0f-2c5d-40e6-bdbb-3895ccdd8c03',
  IcyPenguin: '8fc0905b-551f-4090-87b6-94705c446c4a',
  NeonOtter791: 'f7a4f29b-6d2c-4b69-bd5d-3548b2798a91',
  PhantomMoose: '814ff4dd-24ee-488d-a50a-b4f15322f31a',
  Sparrow_2815: 'aa114632-3d65-4a9d-9f17-3f5b8c2f7e0b',
  WildTiger811: '06418166-5ec2-4299-864c-1a1c41eaa6bb',
  Raven_5685: 'e82a8fbc-c510-4497-85e3-f17634d61ff1',
  QuietWolf: '0326d289-f364-4fcd-951b-31e2d7a258a7',
  SunnyComet451: '16686925-5a66-4fa3-8d32-342d83aac225',
  StormyBadger12: 'cfbd845c-4894-4548-8240-c2503d721cc6',
  ChillViper20: '749deb20-5b6f-4b8e-8ec1-0efed60a4c51',
  Sparrow_6744: '3d26e56d-8657-4aa4-bc43-98bdc46e1249',
  PhantomKoala79: 'e0557621-8142-4c32-bb2d-80f22a35506b',
  Viper_4518: 'fc1400b6-55b5-4d89-8d2c-7bab69f150ed',
  PhantomGecko661: '0c2e0855-cabc-4664-8465-a9dce24ad7b3',
  Ninja_8632: 'fba6b662-bff8-47a2-b507-0fe7c16d1aa4',
  StormyOtter32: 'e1a29751-1a33-4955-9401-373516b8c4fa',
  NeonStorm138: 'bcb682d6-3e11-40f4-bbd3-5e50f716dfa4',
  WildPenguin76: '7e3183b6-4304-44a4-ba1b-2fc4ffd13671',
  QuietSparrow86: '1f182604-e8d3-4486-a52e-d89dca8e1922',
  PhantomYeti920: 'b002c612-3d29-4284-8b9d-b331f9f24bdb',
  RustyNomad86: '9348b976-dc13-4884-97ec-9a8588ea5805',
  Mantis_2627: 'f4966fd4-9203-4ebb-9b55-d289d29972e7',
  SilentDragon96: 'ee9871a0-aa4b-46c4-9d4a-17ac6c9a226e',
  CheekyMoose315: '8a57e0fc-7534-4369-bb63-75ea817a4791',
  Lynx_5575: 'cd3858ea-cb65-4653-bc6a-caa295643279',
};

