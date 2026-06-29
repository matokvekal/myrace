export const loadDictionary = async (name: string) => {
  try {
    const response = await fetch(`/data/${name}.json`);
    if (!response.ok) {
      throw new Error(`Failed to load dictionary: ${name}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`Error loading dictionary ${name}:`, error);
    return {};
  }
};

export const loadClubDictionaryFromFile = async () => {
  try {
    const response = await fetch(`/data/dictionary_clubs.json`);
    if (!response.ok) {
      throw new Error('Failed to load club dictionary');
    }
    return await response.json();
  } catch (error) {
    console.error('Error loading club dictionary:', error);
    return {};
  }
};
