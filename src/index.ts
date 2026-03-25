#!/usr/bin/env node
import { createCli } from './cli/index.js'

const program = createCli()
program.parse(process.argv)
