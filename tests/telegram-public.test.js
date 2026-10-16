import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePublicPage} from '../src/services/import/telegramPublic.js';
test('public channel parser keeps photos attached to their own post',()=>{
 const html=`<a class="tme_messages_more" data-before="90"></a>
 <div class="tgme_widget_message" data-post="supplier/91"><div class="tgme_widget_message_text">Артикул <b>В4348м</b></div><a class="tgme_widget_message_photo_wrap" style="background-image:url('https://cdn4.telesco.pe/file/a.jpg')"></a></div>
 <div class="tgme_widget_message" data-post="supplier/92"><div class="tgme_widget_message_text">A6090</div><a class="tgme_widget_message_photo_wrap" style="background-image:url('https://cdn4.telesco.pe/file/b.jpg')"></a></div>`;
 const result=parsePublicPage(html,'supplier');
 assert.equal(result.before,90);assert.equal(result.posts.length,2);
 assert.deepEqual(result.posts[0].articles,['B4348']);
 assert.deepEqual(result.posts[0].photos,['https://cdn4.telesco.pe/file/a.jpg']);
 assert.deepEqual(result.posts[1].articles,['A6090']);
 assert.equal(parsePublicPage(html,'another').posts.length,0);
});
