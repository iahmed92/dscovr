import { ScrollView, StyleSheet, TouchableOpacity } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Market } from '@/lib/types';

type Props = {
  markets: Market[];
  selectedId: number | null;
  onSelect: (id: number) => void;
};

export function MarketPicker({ markets, selectedId, onSelect }: Props) {
  const theme = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}>
      {markets.map((market) => {
        const selected = market.id === selectedId;
        return (
          <TouchableOpacity
            key={market.id}
            onPress={() => onSelect(market.id)}
            style={[
              styles.pill,
              selected
                ? { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' }
                : { backgroundColor: 'transparent', borderColor: 'rgba(255, 255, 255, 0.1)' },
            ]}>
            <ThemedText
              type="smallBold"
              style={{ color: selected ? '#000000' : theme.text }}>
              {market.name}
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
    paddingVertical: Spacing.two,
  },
  pill: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
    borderWidth: 1,
  },
});
