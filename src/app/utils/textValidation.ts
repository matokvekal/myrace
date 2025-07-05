export const raceValidateText = (text: string): string | null => {
  const trimmedText = text.trim();
  // Ensure the length is between 3 and 100 characters
  if (trimmedText.length < 3 || trimmedText.length > 100) {
    return "Race name must be between 3 and 100 characters.";
  }

  // Regex: Allow letters from multiple languages, numbers, spaces, hyphens (-), and quotes (")
  if (/[^a-zA-Z0-9\u0590-\u05FF\u0600-\u06FF\u0400-\u04FF \-"]/.test(trimmedText)) {
    return 'Race name contains invalid characters. Only letters, numbers, spaces, hyphens (-), and quotes (") are allowed.';
  }

  return null;
};
