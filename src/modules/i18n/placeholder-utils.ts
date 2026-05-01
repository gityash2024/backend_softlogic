const placeholderPattern = /\{[a-zA-Z0-9_.-]+\}/g;

export interface ProtectedText {
  text: string;
  restore: (translated: string) => string;
}

export const protectPlaceholders = (source: string): ProtectedText => {
  const placeholders: string[] = [];
  const text = source.replace(placeholderPattern, (match) => {
    const token = `__SLP${placeholders.length}__`;
    placeholders.push(match);
    return token;
  });

  return {
    text,
    restore: (translated: string) => {
      let restored = translated;
      placeholders.forEach((placeholder, index) => {
        restored = restored.replaceAll(`__SLP${index}__`, placeholder);
      });
      return restored;
    },
  };
};
