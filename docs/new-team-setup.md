# Setting up for a new team

This app is one team's account workspace. Another team runs its own copy,
with its own database, and starts from a team pack: the playbook, team
direction, report templates and settings another team chose to share, or the
neutral starter in `starter/team-pack.json`. No account, person or credential
is ever in a pack.

## 1. Deploy

Follow `deploy/README.md`: a box with Docker, a hostname, and an AWS account
with Bedrock access for the models. Copy `deploy/.env.example` to
`deploy/.env` and fill in at least:

- `APP_HOSTNAME`, the public name (baked into the build).
- `USER1_EMAIL`, `USER1_PASSWORD`, `USER1_NAME`: the first admin. A second
  person can be created the same way with `USER2_*`. These are read once, on
  an empty database.
- The Bedrock region and model variables, and `AI_DAILY_CAP_CENTS`.
- `APP_TIMEZONE` and `FISCAL_YEAR_START_MONTH` for your own calendar.

Then open `/setup` and work through anything it marks.

## 2. The team

Sign in as the first admin and open **Settings, Team**:

- Set the app's name, the team's name, a small logo and the deck colour.
- Add everyone else, each with a first password you give them and a role.
  Roles come from the playbook (step 3), plus Manager; set them after loading
  one.
- Each person changes their own password on the same page.

## 3. The playbook and direction

Either load a pack on **Settings, Team** (download the neutral starter from
the same page, or use a pack another team shared), or:

- **Settings, Playbook**: start from the neutral starter, or import your own
  playbook document (PDF, Word, HTML or text). The draft is shown before it is
  saved; edit any part in the app afterwards.
- **Settings, Team direction**: what the team sells, its goals, and what makes
  an account worth its time.

Every account then gets a Playbook tab: archetype, lifecycle, qualification,
workshop, roadmap and action plan. Meetings get the playbook's questions.

## 4. Optional pieces

- **Assistants**: each is off or on request until you switch it to run on its
  own, with a monthly limit.
- **Calendars**: see `deploy/README.md`, Calendars.
- **Salesforce**: see `deploy/README.md`, Salesforce. Off until turned on
  under Settings, Salesforce, and only with credentials in the environment.

## 5. Sharing your setup

**Settings, Team, Download this team's pack** gives the file another team
loads. It carries the playbook, direction, saved report templates, assistant
settings, name and colour, and the Salesforce mapping (switched off). Before
sharing it, read it: the playbook is your team's own wording.
