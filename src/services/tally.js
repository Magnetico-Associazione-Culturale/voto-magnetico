// Scrutinio: conteggio delle schede, schede cartacee, riconciliazione, parità.

function parseBallot(r) {
  return r.ballot ?? (r.ballot_json ? JSON.parse(r.ballot_json) : null);
}

export function getPaper(db, roundId) {
  const rows = db.prepare('SELECT question_id, data_json FROM paper_results WHERE round_id = ?').all(Number(roundId));
  return Object.fromEntries(rows.map((r) => [r.question_id, JSON.parse(r.data_json)]));
}

export function savePaper(db, roundId, questionId, data) {
  db.prepare(
    `INSERT INTO paper_results (round_id, question_id, data_json) VALUES (?, ?, ?)
     ON CONFLICT (round_id, question_id) DO UPDATE SET data_json = excluded.data_json`,
  ).run(Number(roundId), String(questionId), JSON.stringify(data));
}

export function deletePaper(db, roundId, questionId) {
  db.prepare('DELETE FROM paper_results WHERE round_id = ? AND question_id = ?').run(Number(roundId), String(questionId));
}

export function tallyRound(db, round) {
  const ballot = parseBallot(round);
  if (!ballot) return null;
  const rows = db.prepare('SELECT content FROM ballots WHERE round_id = ?').all(round.id).map((r) => JSON.parse(r.content));
  const usedCodes = db.prepare('SELECT COUNT(*) AS n FROM code_uses WHERE round_id = ?').get(round.id).n;
  const abstained = rows.filter((b) => b.a).length;
  const paper = getPaper(db, round.id);

  const questions = ballot.questions.map((q) => {
    const names = new Map(q.candidates.map((c) => [c.id, c.name]));
    const counts = new Map(q.candidates.map((c) => [c.name, { name: c.name, listed: true, online: 0, paper: 0 }]));
    let blank = 0;
    for (const b of rows) {
      if (b.a) continue;
      const picks = b.q?.[q.id] ?? [];
      if (!picks.length) blank++;
      for (const key of picks) {
        const name = key.startsWith('n:') ? key.slice(2) : names.get(key) ?? key;
        if (!counts.has(name)) counts.set(name, { name, listed: false, online: 0, paper: 0 });
        counts.get(name).online++;
      }
    }

    const p = paper[q.id];
    if (p) {
      for (const [name, n] of Object.entries(p.votes ?? {})) {
        if (!counts.has(name)) counts.set(name, { name, listed: false, online: 0, paper: 0 });
        counts.get(name).paper += Number(n) || 0;
      }
    }

    const ranking = [...counts.values()]
      .map((c) => ({ ...c, total: c.online + c.paper }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'it'));

    return {
      id: q.id,
      title: q.title,
      seats: q.seats,
      maxPrefs: q.maxPrefs,
      ranking,
      blank,
      paper: p ? { schede: Number(p.schede) || 0, bianche: Number(p.bianche) || 0, nulle: Number(p.nulle) || 0 } : null,
      ...electedAndTie(ranking, q.seats),
    };
  });

  return {
    roundId: round.id,
    number: round.number,
    questions,
    totalBallots: rows.length,
    abstained,
    usedCodes,
    // Riconciliazione obbligatoria: ogni codice usato corrisponde a una scheda e viceversa.
    reconciled: usedCodes === rows.length,
    runoffOf: ballot.runoffOf ?? null,
  };
}

/**
 * Eletti = i più votati fino al numero di posti.
 * Se all'ultimo posto utile c'è parità, quei candidati vanno al ballottaggio.
 */
export function electedAndTie(ranking, seats) {
  const withVotes = ranking.filter((r) => r.total > 0);
  if (withVotes.length <= seats) return { elected: withVotes.map((r) => r.name), tie: null };
  const cutoff = withVotes[seats - 1].total;
  const above = withVotes.filter((r) => r.total > cutoff);
  const atCutoff = withVotes.filter((r) => r.total === cutoff);
  if (above.length + atCutoff.length <= seats) {
    return { elected: [...above, ...atCutoff].map((r) => r.name), tie: null };
  }
  return {
    elected: above.map((r) => r.name),
    tie: { votes: cutoff, names: atCutoff.map((r) => r.name), seatsLeft: seats - above.length },
  };
}
