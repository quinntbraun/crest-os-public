// NaN is an in-memory invalid draft marker only. The draft parser blocks save.
export function vehicleYearInput(text:string):number{
  if(!/^-?[0-9]{1,12}$/.test(text))return NaN;
  const value=Number(text);
  return Number.isInteger(value)&&value>=-2147483648&&value<=2147483647?value:NaN;
}
