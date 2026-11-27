CREATE TABLE "figure_preset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" varchar(60) NOT NULL,
	"data" jsonb NOT NULL,
	"data_version" integer NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "figure_preset_name_not_blank" CHECK (char_length(btrim("figure_preset"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "figure_preset" ADD CONSTRAINT "figure_preset_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "figure_preset_user_updated_idx" ON "figure_preset" USING btree ("user_id","updated_at" DESC NULLS LAST);