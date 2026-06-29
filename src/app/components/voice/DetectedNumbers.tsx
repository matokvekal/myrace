import styles from './detectedNumbers.module.css';

interface DetectedNumber {
  bib: string;
  categoryColor?: string;
  timestamp: number;
}

interface DetectedNumbersProps {
  numbers: DetectedNumber[];
  maxItems?: number;
}

export function DetectedNumbers({ numbers, maxItems = 8 }: DetectedNumbersProps) {
  const recentNumbers = numbers.slice(-maxItems);

  return (
    <div className={styles.container}>
      {recentNumbers.length > 0 && (
        <div className={styles.list}>
          {recentNumbers.map((item, idx) => (
            <div
              key={`${item.bib}-${item.timestamp}-${idx}`}
              className={styles.item}
              style={{
                color: item.categoryColor || '#10b981',
                animationDelay: `${idx * 0.05}s`,
              }}
            >
              #{item.bib}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
