const fs = require('fs');

try {
  let content = fs.readFileSync('src/screens/MessagesScreen/MessagesScreen.tsx', 'utf-8');

  // Replace recording wave rendering
  const regex = /\{isVoiceRecordingDraftState \? \([\s\S]*?\{voiceHoldGuideText\.length > 0[\s\S]*?\}\s*<\/Animated\.View>\s*<\/View>\s*\)\}/;
  
  if (regex.test(content)) {
    content = content.replace(regex, `{isVoiceRecordingDraftState ? (
                        <View className="h-[20px] flex-1 flex-row items-center">
                          <View className="h-[4px] flex-1 rounded-full bg-[#dbe3ee] overflow-hidden">
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
                      )}`);
    console.log("Recording Wave matched and replaced.");
  } else {
    console.log("Regex did not match.");
  }

  fs.writeFileSync('src/screens/MessagesScreen/MessagesScreen.tsx', content, 'utf-8');
} catch (e) {
  console.error(e);
}
