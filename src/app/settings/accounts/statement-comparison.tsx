import type {StatementDraft} from '../../../bookkeeping/statement-staging-contract';

type Values={openingCents:string;closingCents:string;signedRowsCents:string;statementDifferenceCents:string;
  startsOn:string;endsOn:string;rowCount:number};
const dateFormat=new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
const dateLabel=(value:string)=>dateFormat.format(new Date(value+'T12:00:00Z'));

export function StatementComparison({values,format,saved=false}:{values:Values;format:(value:string)=>string;saved?:boolean}){
  const calculatedClosing=(BigInt(values.openingCents)+BigInt(values.signedRowsCents)).toString();
  const unresolved=BigInt(values.statementDifferenceCents)!==0n;
  return <section className="statement-comparison" aria-label={saved?'Staged statement balances':'Statement balance review'}>
    <h4>{saved?'Staged statement balances':'Review statement balances'}</h4>
    <p className="field-help statement-review-scope">USD · {values.rowCount} rows · <time dateTime={values.startsOn}>{dateLabel(values.startsOn)}</time>
      {' '}– <time dateTime={values.endsOn}>{dateLabel(values.endsOn)}</time></p>
    <dl className="statement-balance-grid">
      <div><dt>Opening balance</dt><dd>{format(values.openingCents)}</dd></div>
      <div><dt>Signed row total</dt><dd>{format(values.signedRowsCents)}</dd></div>
      <div><dt>Calculated closing</dt><dd>{format(calculatedClosing)}</dd></div>
      <div><dt>Statement closing</dt><dd>{format(values.closingCents)}</dd></div>
    </dl>
    <p className="field-help">Calculated closing is the opening balance plus the signed row total.</p>
    <div className="statement-difference" data-unresolved={unresolved}>
      <dl><div><dt>Statement difference</dt><dd>{format(values.statementDifferenceCents)}</dd></div></dl>
      <p>{unresolved?'Difference needs review':'Rows match the stated balances'}</p>
      <p className="field-help">{unresolved?'Staging retains this difference for review.':'This checks the entered statement arithmetic only.'} Staging does not reconcile the account.</p>
    </div>
  </section>;
}

export function StatementEvidence({values,reference,rowsSha256}:{
  values:Pick<StatementDraft,'fileSha256'|'dateConvention'|'completenessEvidence'>;reference?:string;rowsSha256?:string;
}){
  return <details className="statement-evidence"><summary>Statement evidence</summary>
    <dl><dt>Source file checksum</dt><dd><code>{values.fileSha256}</code></dd>
      <dt>Provider date convention</dt><dd>{values.dateConvention}</dd>
      <dt>Completeness review</dt><dd>{values.completenessEvidence}</dd>
      {rowsSha256&&<><dt>Saved rows checksum</dt><dd><code>{rowsSha256}</code></dd></>}
      {reference&&<><dt>Save reference</dt><dd><code>{reference}</code></dd></>}
    </dl>
  </details>;
}
