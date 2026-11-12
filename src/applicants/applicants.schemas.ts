import { z } from "zod";
import { STAGE_CODES, reasonRequiredFor } from "./stages.ts";

export const idParamSchema = z.object({
  id: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)),
});
const regex = /^\+?[0-9]{8,15}$/; // tight regex for phone number format.

// teks satu baris: tidak boleh ada karakter kontrol (null, tab, newline, dst.)
const text = (max: number) =>
  z.string().trim().min(1).max(max).regex(/^[^\u0000-\u001f\u007f]*$/, "tidak boleh mengandung karakter kontrol");

export const createApplicantSchema = z.object({
  name: text(100),
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  phone: z.string().trim().regex(regex).optional().nullable(),
  position: text(100),
  batch: text(50),
});

export const listQuerySchema = z.object({
  stage: z.enum(STAGE_CODES).optional(),
  position: text(100).optional(),
  batch: text(50).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const updateStageSchema = z
  .object({
    to_stage: z.enum(STAGE_CODES),
    reason: z.string().trim().max(500).optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .refine((v) => !reasonRequiredFor(v.to_stage) || !!v.reason, {
    path: ["reason"],
    message: "reason wajib untuk stage ini",
  });

// Tipe input diturunkan dari schema, bukan ditulis ulang:
export type CreateApplicantInput = z.infer<typeof createApplicantSchema>;
export type ListQuery = z.infer<typeof listQuerySchema>;
export type UpdateStageInput = z.infer<typeof updateStageSchema>;
