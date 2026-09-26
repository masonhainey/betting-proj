// Tags headlines into the buckets bettors actually care about.

const RULES = [
  ["injury", /\b(injur|out for|ruled out|questionable|doubtful|day-to-day|surgery|torn|acl|concussion|sidelined|status for|return(s|ing)? from|won't play|will not play|out indefinitely|season-ending)/i],
  ["lines", /\b(odds|spread|line(s)? (move|moves|moved|movement)|favou?rite|underdog|betting|best bets|picks against|over\/under|sportsbook|point spread|money ?line|parlay|upset alert)/i],
  ["interview", /\b(said|says|press conference|told reporters|interview|podcast|reacts?|on why|opens up|sounds off|explains)\b/i],
  ["preview", /\b(preview|predictions?|what to watch|key matchups?|storylines|look ahead|lookahead|week \d+|keys to|breaking down|scouting|takeaways|primer)\b/i],
  ["rankings", /\b(ap poll|coaches poll|rankings|top 25|cfp|playoff (picture|projection|rankings)|power rankings|heisman)\b/i],
  ["portal", /\b(transfer|portal|commit(s|ment)?|recruit|signing day|decommit|flip(s|ped)?)\b/i],
];

export const TAGS = {
  injury: "Injury",
  lines: "Lines & odds",
  interview: "Interviews",
  preview: "Look-ahead",
  rankings: "Rankings",
  portal: "Portal & recruiting",
  move: "Line move",
};

export function tagArticle(a) {
  const text = `${a.headline} ${a.description}`;
  const tags = RULES.filter(([, re]) => re.test(text)).map(([t]) => t);
  return tags.length ? tags : ["general"];
}

/** Does an article mention a team? Match on full name, short name or school. */
export function mentionsTeam(a, t) {
  const text = `${a.headline} ${a.description} ${(a.teams || []).join(" ")}`.toLowerCase();
  return [t.name, t.short].filter((s) => s && s.length > 3).some((s) => text.includes(s.toLowerCase()));
}
