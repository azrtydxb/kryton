CREATE TABLE "TunnelTrafficDaily" (
	"day" date PRIMARY KEY NOT NULL,
	"requests" bigint DEFAULT 0 NOT NULL,
	"bytesIn" bigint DEFAULT 0 NOT NULL,
	"bytesOut" bigint DEFAULT 0 NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
