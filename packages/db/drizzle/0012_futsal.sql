-- Futsal (Futsal Laws of the Game, as used by Football Australia): a seventh sport for competitions.
ALTER TABLE "competitions" DROP CONSTRAINT "competitions_sport_chk";--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_sport_chk" CHECK ("competitions"."sport" in ('football','basketball','netball','rugby_league','afl','hockey','futsal'));
