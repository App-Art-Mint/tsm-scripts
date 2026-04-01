import { ssoCommand } from '../sso-command';

const branch = process.argv[2];
if (!branch) {
  console.error('Please specify a branch to use');
  process.exit(1);
}

ssoCommand(
  `ampx generate outputs --app-id $AMPLIFY_ID --branch ${branch} --format json --out-dir ./`,
);
