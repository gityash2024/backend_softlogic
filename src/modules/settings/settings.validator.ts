import { z } from 'zod';

const colorEntrySchema = z.union([
  z.string().trim().min(1).max(16),
  z.number().int(),
]);

export const updateSettingsSchema = z.object({
  timezone: z.string().trim().min(2).max(120).optional(),
  language: z.string().trim().min(2).max(20).optional(),
  performanceMode: z.boolean().optional(),
  profanityFilter: z.boolean().optional(),
  autoTimezoneEnabled: z.boolean().optional(),
  customProfanityWords: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required',
});

export const updateColorsSchema = z.object({
  recentColors: z.array(colorEntrySchema).max(24).optional(),
  favoriteColors: z.array(colorEntrySchema).max(24).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required',
});
