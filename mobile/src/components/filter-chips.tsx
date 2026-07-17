import { ScrollView, StyleSheet, TouchableOpacity } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Option<T> = { value: T; label: string };

type Props<T> = {
  options: Option<T>[];
  selected: T;
  onSelect: (value: T) => void;
  accessibilityLabel: string;
};

// Same pill treatment as MarketPicker, generic over the value so the timeframe
// and vibe rows aren't two near-identical components.
export function FilterChips<T extends string>({
  options,
  selected,
  onSelect,
  accessibilityLabel,
}: Props<T>) {
  const theme = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={accessibilityLabel}
      contentContainerStyle={styles.row}>
      {options.map((option) => {
        const isSelected = option.value === selected;
        return (
          <TouchableOpacity
            key={option.value}
            onPress={() => onSelect(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={option.label}
            style={[
              styles.pill,
              {
                backgroundColor: isSelected ? theme.text : theme.backgroundElement,
                borderColor: theme.backgroundSelected,
              },
            ]}>
            <ThemedText
              type="small"
              style={{ color: isSelected ? theme.background : theme.textSecondary }}>
              {option.label}
            </ThemedText>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  pill: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
