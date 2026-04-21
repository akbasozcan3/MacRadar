const fs = require('fs');

try {
  let lines = fs.readFileSync('src/screens/MessagesScreen/MessagesScreen.tsx', 'utf-8').split(/\r?\n/);
  
  let startIdx = lines.findIndex(l => l.includes('{isVoiceRecordingDraftState ? ('));
  let endIdx = lines.findIndex((l, i) => i > startIdx && l.includes(')}') && l.trim() === ')}');

  if (startIdx !== -1 && endIdx !== -1) {
      const replacement = `                      {isVoiceRecordingDraftState ? (
                        <View className="h-[20px] flex-1 flex-row items-center overflow-hidden">
                          <View className="h-[4px] flex-1 rounded-full bg-[#dbe3ee]">
                            <View 
                              className="h-full bg-[#ef4444]" 
                              style={{ width: isVoiceRecordingPreview && voiceRecordingDraft ? \`\${(previewPlaybackElapsedSec / (voiceRecordingDraft.durationSec || 1)) * 100}%\` : '0%' }} 
                            />
                          </View>
                        </View>
                      ) : (
                        <View className="flex-1 justify-center">
                          <Animated.View
                            style={{ opacity: voiceRecordingGuideOpacity }}
                            className="flex-row items-center justify-start ml-2"
                          >
                            <FeatherIcon color="#64748b" name="chevron-left" size={14} />
                            <Text
                              allowFontScaling={false}
                              className="ml-2 text-[13px] font-medium text-[#64748b]"
                              numberOfLines={1}
                            >
                              {voiceHoldGuideText.length > 0
                                ? voiceHoldGuideText
                                : 'Sola kaydir, iptal et'}
                            </Text>
                          </Animated.View>
                        </View>
                      )}`;
      lines.splice(startIdx, endIdx - startIdx + 1, ...replacement.split('\n'));
      fs.writeFileSync('src/screens/MessagesScreen/MessagesScreen.tsx', lines.join('\n'), 'utf-8');
      console.log('Replaced composer waveform.');
  } else {
      console.log('Could not find bounds: start', startIdx, 'end', endIdx);
  }
} catch (e) {
  console.error(e);
}
