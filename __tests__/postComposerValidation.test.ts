import {
  extractProfilePostHashtags,
  validateProfilePostInput,
} from '../src/features/profilePosts/postComposerValidation';

describe('postComposerValidation', () => {
  it('extracts unique hashtags with Turkish characters', () => {
    expect(
      extractProfilePostHashtags(
        'Aksam surusu #Bogaz #İstanbul #bogaz #Gece_Surusu',
      ),
    ).toEqual(['bogaz', 'istanbul', 'gece_surusu']);
  });

  it('rejects captions with too many hashtags', () => {
    const caption =
      '#bir #iki #uc #dort #bes #alti #yedi #sekiz #dokuz rota notu';

    expect(
      validateProfilePostInput({
        caption,
        location: 'Istanbul',
        mediaType: 'photo',
        mediaUrl: 'https://cdn.macradar.app/example.jpg',
      }),
    ).toBe('Bir gonderide en fazla 8 etiket kullanabilirsin.');
  });
});
