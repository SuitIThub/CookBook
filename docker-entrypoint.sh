#!/bin/sh
npm run db:init
npm run db:migrate
npm run build
exec npm run start 