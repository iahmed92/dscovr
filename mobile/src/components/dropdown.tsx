import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type DropdownOption<T> = { value: T; label: string };

type Props<T> = {
  options: DropdownOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  placeholder?: string;
  accessibilityLabel: string;
};

// Styled dropdown rather than a platform picker: RN has no <select>, and the
// native iOS/Android pickers carry their own chrome that clashes with the dark
// minimal look. The trigger stays quiet (transparent + hairline) because the
// selected label is itself the state indicator — no active/inactive colouring
// needed the way pills required.
export function Dropdown<T extends string | number>({
  options,
  value,
  onChange,
  placeholder = 'Select',
  accessibilityLabel,
}: Props<T>) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  const selected = options.find((o) => o.value === value);

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={[styles.trigger, { borderColor: 'rgba(255, 255, 255, 0.1)' }]}>
        <ThemedText style={styles.triggerText} numberOfLines={1}>
          {selected?.label ?? placeholder}
        </ThemedText>
        <ThemedText style={[styles.chevron, { color: theme.textSecondary }]}>▾</ThemedText>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        {/* Backdrop doubles as the dismiss target. */}
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable
            style={[styles.panel, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
            onPress={(e) => e.stopPropagation()}>
            <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
              {options.map((option) => {
                const isSelected = option.value === value;
                return (
                  <TouchableOpacity
                    key={String(option.value)}
                    onPress={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={option.label}
                    style={[
                      styles.option,
                      isSelected && { backgroundColor: theme.backgroundSelected },
                    ]}>
                    <ThemedText style={styles.optionText} numberOfLines={1}>
                      {option.label}
                    </ThemedText>
                    {isSelected && <ThemedText style={styles.check}>✓</ThemedText>}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + 2,
    paddingHorizontal: Spacing.three - 2,
    paddingVertical: Spacing.two,
    borderRadius: 999,
    borderWidth: 1,
  },
  triggerText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  chevron: {
    fontSize: 11,
    lineHeight: 14,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  panel: {
    width: '100%',
    maxWidth: Math.min(340, MaxContentWidth),
    maxHeight: '70%',
    borderRadius: 14,
    borderWidth: 1,
    padding: Spacing.one + 2,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three - 2,
    paddingVertical: Spacing.three - 4,
    borderRadius: 10,
  },
  optionText: {
    fontSize: 15,
    lineHeight: 20,
    flex: 1,
  },
  check: {
    fontSize: 13,
  },
});
