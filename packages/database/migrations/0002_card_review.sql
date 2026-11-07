ALTER TABLE "student_cards" ADD COLUMN "review_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "student_cards" ADD COLUMN "duplicate_student_id" uuid;--> statement-breakpoint
ALTER TABLE "student_cards" ADD COLUMN "duplicate_similarity" real;--> statement-breakpoint
ALTER TABLE "student_cards" ADD COLUMN "name_matched" boolean;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "consent_version" text;--> statement-breakpoint
ALTER TABLE "student_cards" ADD CONSTRAINT "student_cards_duplicate_student_id_students_id_fk" FOREIGN KEY ("duplicate_student_id") REFERENCES "public"."students"("id") ON DELETE set null ON UPDATE no action;