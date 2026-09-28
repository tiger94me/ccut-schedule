// 语音听写：Web Speech API（zh-CN）。不支持的浏览器自动降级（调用方隐藏按钮）。

export const speechSupported = typeof window !== 'undefined'
  && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

/**
 * 创建听写会话。
 * onText(finalText, interimText)：识别结果回调（finalText 为已确认文本，interim 为临时文本）
 * onError(message)：出错回调
 * 返回 { start, stop, listening }
 */
export function createDictation({ onText, onError, onStateChange } = {}) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) throw new Error('当前浏览器不支持语音识别');

  const rec = new SR();
  rec.lang = 'zh-CN';
  rec.continuous = true;
  rec.interimResults = true;

  let listening = false;
  let manualStop = false;
  let finalText = '';
  let interimText = '';

  const setListening = v => {
    listening = v;
    if (onStateChange) onStateChange(v);
  };

  rec.onresult = (e) => {
    interimText = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interimText += r[0].transcript;
    }
    if (onText) onText(finalText, interimText);
  };

  rec.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return; // 可忽略的噪声错误
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      manualStop = true;
      setListening(false);
      if (onError) onError('麦克风权限被拒绝，请在浏览器设置中允许');
      return;
    }
    if (onError) onError(`语音识别出错：${e.error}`);
  };

  rec.onend = () => {
    // 连续听写：非人为停止时自动重启（部分浏览器会话会自动断开）
    if (!manualStop && listening) {
      try { rec.start(); } catch { setListening(false); }
    } else {
      setListening(false);
    }
  };

  return {
    get listening() { return listening; },
    start(baseText = '') {
      manualStop = false;
      finalText = baseText;
      interimText = '';
      try {
        rec.start();
        setListening(true);
      } catch (err) {
        if (onError) onError('无法启动语音识别');
      }
    },
    stop() {
      manualStop = true;
      try { rec.stop(); } catch { /* ignore */ }
      setListening(false);
      return finalText;
    },
  };
}
