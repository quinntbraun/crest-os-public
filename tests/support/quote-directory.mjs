// Use the same visible return control as a phone user. This reveals the saved
// list without reloading the page or bypassing the draft/operation safeguards.
export async function showQuoteDirectory(page){
 const directory=page.locator('#quote-saved-directory');
 if(await directory.count()&&!await directory.isVisible())
  await page.getByRole('button',{name:'Back to saved quotes',exact:true}).click();
}
