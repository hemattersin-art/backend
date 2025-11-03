const supabase = require('../config/supabase');
const { successResponse, errorResponse } = require('../utils/helpers');

// Get user conversations
const getConversations = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    let conversations;
    if (userRole === 'client') {
      // req.user.id is already the client ID, no need to lookup
      const clientId = userId;

      const { data, error } = await supabase
        .from('conversations')
        .select(`
          *,
          psychologist:psychologists(first_name, last_name, email, cover_image_url),
          session:sessions(scheduled_date, scheduled_time, status),
          messages:messages(count)
        `)
        .eq('client_id', clientId)
        .eq('is_active', true)
        .order('last_message_at', { ascending: false });

      if (error) throw error;
      conversations = data;
    } else if (userRole === 'psychologist') {
      // Get psychologist conversations
      const { data, error } = await supabase
        .from('conversations')
        .select(`
          *,
          client:clients(first_name, last_name, child_name, child_age),
          session:sessions(scheduled_date, scheduled_time, status),
          messages:messages(count)
        `)
        .eq('psychologist_id', userId)
        .eq('is_active', true)
        .order('last_message_at', { ascending: false });

      if (error) throw error;
      conversations = data;
    }

    res.json(successResponse('Conversations retrieved successfully', { conversations }));
  } catch (error) {
    console.error('Error getting conversations:', error);
    res.status(500).json(errorResponse('Failed to get conversations'));
  }
};

// Get messages for a conversation
const getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Verify user has access to this conversation
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .single();

    if (convError || !conversation) {
      return res.status(404).json(errorResponse('Conversation not found'));
    }

    // Check if user has access to this conversation
    if (userRole === 'client') {
      if (conversation.client_id !== userId) {
        return res.status(403).json(errorResponse('Access denied'));
      }
    } else if (userRole === 'psychologist') {
      if (conversation.psychologist_id !== userId) {
        return res.status(403).json(errorResponse('Access denied'));
      }
    }

    // Get messages
    const { data: messages, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    res.json(successResponse('Messages retrieved successfully', { messages }));
  } catch (error) {
    console.error('Error getting messages:', error);
    res.status(500).json(errorResponse('Failed to get messages'));
  }
};

// Send a message
const sendMessage = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { content, messageType = 'text' } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

    if (!content || content.trim() === '') {
      return res.status(400).json(errorResponse('Message content is required'));
    }

    // Optimized: Single query to verify access and get conversation
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, client_id, psychologist_id')
      .eq('id', conversationId)
      .single();

    if (convError || !conversation) {
      return res.status(404).json(errorResponse('Conversation not found'));
    }

    // Check if user has access to this conversation
    if (userRole === 'client') {
      if (conversation.client_id !== userId) {
        return res.status(403).json(errorResponse('Access denied'));
      }
    } else if (userRole === 'psychologist') {
      if (conversation.psychologist_id !== userId) {
        return res.status(403).json(errorResponse('Access denied'));
      }
    }

    // Create message and update conversation in a single transaction
    const { data: message, error } = await supabase
      .from('messages')
      .insert([{
        conversation_id: conversationId,
        sender_id: userId,
        sender_type: userRole,
        content: content.trim(),
        message_type: messageType
      }])
      .select('*')
      .single();

    if (error) throw error;

    // Update conversation last_message_at (non-blocking)
    supabase
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversationId)
      .then(() => {}) // Fire and forget
      .catch(err => console.error('Failed to update conversation timestamp:', err));

    res.json(successResponse('Message sent successfully', { message }));
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json(errorResponse('Failed to send message'));
  }
};

// Mark messages as read
const markAsRead = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Verify user has access to this conversation
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .single();

    if (convError || !conversation) {
      return res.status(404).json(errorResponse('Conversation not found'));
    }

    // Check if user has access to this conversation
    if (userRole === 'client') {
      if (conversation.client_id !== userId) {
        return res.status(403).json(errorResponse('Access denied'));
      }
    } else if (userRole === 'psychologist') {
      if (conversation.psychologist_id !== userId) {
        return res.status(403).json(errorResponse('Access denied'));
      }
    }

    // Mark messages as read
    const { error } = await supabase
      .from('messages')
      .update({ is_read: true })
      .eq('conversation_id', conversationId)
      .neq('sender_type', userRole);

    if (error) throw error;

    res.json(successResponse('Messages marked as read'));
  } catch (error) {
    console.error('Error marking messages as read:', error);
    res.status(500).json(errorResponse('Failed to mark messages as read'));
  }
};

// Create new conversation
const createConversation = async (req, res) => {
  try {
    const { sessionId } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

    console.log('=== CREATE CONVERSATION DEBUG ===');
    console.log('Session ID:', sessionId);
    console.log('User ID:', userId);
    console.log('User Role:', userRole);

    if (!sessionId) {
      return res.status(400).json(errorResponse('Session ID is required'));
    }

    // Get session details
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('client_id, psychologist_id')
      .eq('id', sessionId)
      .single();

    console.log('Session lookup - ID:', session?.id, 'Error:', sessionError ? 'Yes' : 'No');

    if (sessionError || !session) {
      return res.status(404).json(errorResponse('Session not found'));
    }

    // Verify user has access to this session
    if (userRole === 'client') {
      const { data: client, error: clientError } = await supabase
        .from('clients')
        .select('id')
        .eq('id', userId)
        .single();

      console.log('Client lookup - ID:', client?.id, 'Error:', clientError ? 'Yes' : 'No');
      console.log('Session client_id:', session.client_id);
      console.log('Client id:', client?.id);

      if (!client || session.client_id !== client.id) {
        console.log('Access denied: client not found or ID mismatch');
        return res.status(403).json(errorResponse('Access denied'));
      }
    } else if (userRole === 'psychologist') {
      console.log('Psychologist ID check:', userId, 'vs', session.psychologist_id);
      if (session.psychologist_id !== userId) {
        console.log('Access denied: psychologist ID mismatch');
        return res.status(403).json(errorResponse('Access denied'));
      }
    }

    // Check if conversation already exists
    const { data: existingConversation } = await supabase
      .from('conversations')
      .select('id')
      .eq('client_id', session.client_id)
      .eq('psychologist_id', session.psychologist_id)
      .eq('session_id', sessionId)
      .single();

    if (existingConversation) {
      console.log('Conversation already exists:', existingConversation);
      return res.json(successResponse('Conversation already exists', { conversationId: existingConversation.id }));
    }

    // Create new conversation
    const { data: conversation, error } = await supabase
      .from('conversations')
      .insert([{
        client_id: session.client_id,
        psychologist_id: session.psychologist_id,
        session_id: sessionId
      }])
      .select('*')
      .single();

    if (error) {
      console.error('Error creating conversation:', error);
      throw error;
    }

    console.log('New conversation created:', conversation);
    res.json(successResponse('Conversation created successfully', { conversation }));
  } catch (error) {
    console.error('Error creating conversation:', error);
    res.status(500).json(errorResponse('Failed to create conversation'));
  }
};

module.exports = {
  getConversations,
  getMessages,
  sendMessage,
  markAsRead,
  createConversation
};
