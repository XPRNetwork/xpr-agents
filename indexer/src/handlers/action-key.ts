import { StreamAction } from '../stream';

export function actionKey(action: StreamAction): string {
  return action.global_sequence > 0
    ? `${action.act.account}:${action.global_sequence}`
    : `${action.act.account}:${action.trx_id}:${action.action_ordinal}`;
}
