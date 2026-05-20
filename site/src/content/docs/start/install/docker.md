---
title: Install with Docker
description: The fastest way to run Kryton on your machine. Two commands, then open a browser.
---

This is the recommended path. Docker is a tool that runs apps in self-contained boxes called containers, so you don't have to install databases or runtimes by hand. If you don't have it yet, grab [Docker Desktop](https://www.docker.com/products/docker-desktop/) and let it finish installing before you continue.

## 1. Get the code

```sh
git clone https://github.com/azrtydxb/kryton.git
```

This downloads the Kryton project into a new folder called `kryton`.

## 2. Start it

```sh
cd kryton && docker compose up --build -d
```

The first run takes a couple of minutes — Docker downloads images and builds the server. The `-d` means "run in the background".

## 3. Open it

Point your browser at:

```
http://localhost:3000
```

You'll see the sign-in page.

![Login screen](/kryton/screenshots/login.png)

## 4. Register the first user

Click **Create account** and fill in your email and a password. The very first account you create becomes the **admin** — keep those credentials somewhere safe.

## Common adjustments

**Port 3000 already taken?** Edit `docker-compose.yml` (or set `KRYTON_PORT=4000` in a `.env` file next to it) and re-run step 2. Then open `http://localhost:4000`.

**Stop everything:**

```sh
docker compose down
```

**Start it again later:**

```sh
docker compose up -d
```

## Where your data lives

- Notes (markdown files): `./notes/` inside the `kryton` folder you cloned.
- Database (users, links, tags): a Docker-managed Postgres volume named `kryton_pgdata`.

Back up both if you want a real backup. The notes folder alone is enough to recover the content; the database holds metadata.

## Next

Now wire your AI tools to Kryton — see [Connect your AI](/kryton/start/connect-ai/).
