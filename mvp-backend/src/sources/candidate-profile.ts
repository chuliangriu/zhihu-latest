/** Reads authored display facts from the stable three-part synthetic-card format. */
export function syntheticCardProfile(text: string): { profileBackground: string[]; recentFocus: string | null } {
  const sections = text.split(/\n\s*\n/u).map(value => value.trim()).filter(Boolean);
  const backgroundText = sections.find(value => !/^(?:最近(?:最明显的)?一条线|[他她Tt][Aa]说)[：:]/u.test(value)) ?? "";
  const focusSection = sections.find(value => /^最近(?:最明显的)?一条线[：:]/u.test(value));
  const profileBackground = splitLimitedBackground(backgroundText);
  const recentFocus = focusSection?.replace(/^最近(?:最明显的)?一条线[：:]\s*/u, "").trim() || null;
  return {
    profileBackground,
    recentFocus: recentFocus && [...recentFocus].length <= 90 ? recentFocus : null
  };
}

/** Preserves confirmed wording while fitting the two-paragraph, 80-char display contract. */
export function splitLimitedBackground(value: unknown): string[] {
  const text = typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
  if (!text) return [];
  const sentences = text.match(/[^。！？!?]+[。！？!?]?/gu)?.map(item => item.trim()).filter(Boolean) ?? [];
  if (!sentences.length) return [];
  if (sentences.every(sentence => [...sentence].length <= 80)) {
    if (sentences.length === 1) return [sentences[0]!];
    for (let split = 1; split < sentences.length; split += 1) {
      const first = sentences.slice(0, split).join("");
      const second = sentences.slice(split).join("");
      if ([...first].length <= 80 && [...second].length <= 80) return [first, second];
    }
  }
  // A long confirmed sentence may not contain a full stop. Split only its
  // display line and retain the original wording; cap the existing 160-char
  // background contract without asking a model to rewrite it.
  const characters = [...text].slice(0, 160);
  return characters.length <= 80 ? [characters.join("")] : [characters.slice(0, 80).join(""), characters.slice(80).join("")];
}
