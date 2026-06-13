export const LOCATIONS = [
  "Airport",
  "Bank",
  "Beach",
  "Casino",
  "Circus",
  "Hospital",
  "Hotel",
  "Military Base",
  "Movie Studio",
  "Ocean Liner",
  "Passenger Train",
  "Pirate Ship",
  "Police Station",
  "Restaurant",
  "School",
  "Space Station",
  "Submarine",
  "Supermarket",
  "Theater",
  "University"
];

export function createGame(players) {
  if (players.length === 0) {
    throw new Error("Cannot create game with zero players");
  }

  const location = LOCATIONS[Math.floor(Math.random() * LOCATIONS.length)];
  const spy = players[Math.floor(Math.random() * players.length)];
  const firstQuestioner = players[Math.floor(Math.random() * players.length)];

  return {
    location,
    spyId: spy.id,
    phase: "asking",
    currentQuestionerId: firstQuestioner.id,
    currentAnswererId: null,
    previousQuestionerId: null,
    beliefUpdate: null,
    beliefUpdates: [],
    accuserIds: [],
    accusation: null,
    accusations: [],
    result: null,
    startedAt: new Date().toISOString()
  };
}