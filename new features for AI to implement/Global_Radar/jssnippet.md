document.querySelectorAll('a').forEach(el => {     el.innerText = `${el.innerText} [${el.href}]`; });


const checkTime = new Date().toLocaleString(); document.querySelectorAll('a').forEach(el => {     el.innerText = `${el.innerText} [${el.href}] [Checked: ${checkTime}]`; });
